// Start of util.js

function futhark_assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

function make_prim_info(tag, size, scalar_type, array_type, create_array, get_heap) {
  return {
    tag: tag, // tag used in the binary data format
    size: size,
    scalar_type: scalar_type,
    array_type: array_type,
    get_heap: get_heap,
    create_array: create_array,
  };
}

const primInfos = {
  'bool': make_prim_info("bool", 1, Boolean, Uint8Array,     (h, ...args) => new Uint8Array(h, ...args),     (m) => m.HEAPU8),
    'u8': make_prim_info("  u8", 1, Number,  Uint8Array,     (h, ...args) => new Uint8Array(h, ...args),     (m) => m.HEAPU8),
    'i8': make_prim_info("  i8", 1, Number,  Int8Array,      (h, ...args) => new Int8Array(h, ...args),      (m) => m.HEAP8),
   'u16': make_prim_info(" u16", 2, Number,  Uint16Array,    (h, ...args) => new Uint16Array(h, ...args),    (m) => m.HEAPU16),
   'i16': make_prim_info(" i16", 2, Number,  Int16Array,     (h, ...args) => new Int16Array(h, ...args),     (m) => m.HEAP16),
   'u32': make_prim_info(" u32", 4, Number,  Uint32Array,    (h, ...args) => new Uint32Array(h, ...args),    (m) => m.HEAPU32),
   'i32': make_prim_info(" i32", 4, Number,  Int32Array,     (h, ...args) => new Int32Array(h, ...args),     (m) => m.HEAP32),
   'u64': make_prim_info(" u64", 8, BigInt,  BigUint64Array, (h, ...args) => new BigUint64Array(h, ...args), (m) => m.HEAPU64),
   'i64': make_prim_info(" i64", 8, BigInt,  BigInt64Array,  (h, ...args) => new BigInt64Array(h, ...args),  (m) => m.HEAP64),
   // There is no WASM heap for f16 values since Float16Array was only recently (april 2025) made available in browser baselines,
   // so we have to do this ugly workaround to reinterpret Uint16 bytes as Float16 when reading from the WASM HEAPU16...
   'f16': make_prim_info(" f16", 2, Number,  Float16Array,   (h, ...args) => new Float16Array(new Uint16Array(h, ...args).buffer), (m) => m.HEAPU16),
   'f32': make_prim_info(" f32", 4, Number,  Float32Array,   (h, ...args) => new Float32Array(h, ...args),   (m) => m.HEAPF32),
   'f64': make_prim_info( "f64", 8, Number,  Float64Array,   (h, ...args) => new Float64Array(h, ...args),   (m) => m.HEAPF64),
};

// End of util.js

// Start of values.js

const futhark_binary_format_version = 2;

class FutharkReader {
  constructor(buf) {
    futhark_assert(buf instanceof Uint8Array);
    this.buf = buf;
  }

  seek(n) {
    this.buf = this.buf.subarray(n);
  }

  read_byte() {
    const b = this.buf[0];
    this.seek(1);
    return b;
  }

  read_i64() {
    const buf = new Uint8Array(this.buf.subarray(0, 8));
    const val = new BigInt64Array(buf.buffer, 0, 1)[0];
    this.seek(8);
    return val;
  }

  read_value(expected_type = undefined) {
    let off = 0;
    while (this.is_whitespace(this.buf[off])) off++;
    this.seek(off);

    futhark_assert(this.read_byte() == this.byte_val('b'),
      "Expected binary input");
    futhark_assert(this.read_byte() == futhark_binary_format_version,
      "Can only read binary format version " + futhark_binary_format_version);
    
    const rank = this.read_byte();

    const type = String.fromCodePoint(...this.buf.slice(0, 4)).trimStart();
    futhark_assert(type in primInfos, "Unknown type: " + type);
    this.seek(4);

    if (expected_type != undefined) {
      if (rank == 0 && expected_type != type) {
        throw new Error(`Read unexpected type '${rank}d ${type}', expected ${expected_type}`);
      }
      if (rank > 0) {
        let expected_rank = 0;
        let rem_type = expected_type;
        while (rem_type.startsWith("[]")) {
          expected_rank++;
          rem_type = rem_type.slice(2);
        }

        if (rank != expected_rank || type != rem_type) {
          throw new Error(`Read unexpected type '${rank}d ${type}', expected ${expected_type}`);
        }
      }
    }

    let shape = [];
    for (let i = 0; i < rank; i++) {
      shape.push(this.read_i64());
    }

    if (rank == 0) { 
      const [val, _] = this.read_array(type, [1n]);
      return val[0];
    }
    else { 
      return this.read_array(type, shape);
    }
  }

  read_array(type, shape) {
    const type_info = primInfos[type];
    const flat_len = Number(shape.reduce((a, b) => a * b));

    const buf = new Uint8Array(this.buf.subarray(0, flat_len * type_info.size));
    const wrapper = new type_info.array_type(buf.buffer, 0, flat_len);

    this.seek(wrapper.byteLength);
    return [wrapper, shape];
  }

  is_whitespace(b) {
    const whitespace = [' ', '\t', '\n'].map((c) => this.byte_val(c));
    return b in whitespace;
  }

  byte_val(c) { return c.charCodeAt(0); }
}

class FutharkWriter {
  encode_value(val, type) {
    let elem_type = undefined;
    let rank = 0;
    let flat_len = 0;

    if (type in primInfos) {
      elem_type = type;
      rank = 0;
      flat_len = 1;
    }
    else {
      elem_type = type.replaceAll("[]", "");
      const [data, shape] = val;
      rank = shape.length;
      flat_len = Number(shape.reduce((a, b) => a * b));
    }
  
    const prim_info = primInfos[elem_type];
    const header_size = 3 + 4;
    const total_size = header_size + rank * 8 + flat_len * prim_info.size;

    const buf = new Uint8Array(total_size);
    buf[0] = this.byte_val('b');
    buf[1] = futhark_binary_format_version;
    buf[2] = rank;

    const tag = Uint8Array.from(prim_info.tag, c => c.charCodeAt(0));
    buf.set(tag, 3);
    
    let offset = header_size;

    let data = undefined;
    let shape = undefined;
    if (rank == 0) {
      data = new prim_info.array_type([val]);
      shape = [];
    }
    else {
      const [d, s] = val;
      data = d;
      shape = s;
    }

    const dims = new BigInt64Array(shape);
    buf.set(new Uint8Array(dims.buffer), offset);
    offset += dims.byteLength;

    const bin_data = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    buf.set(bin_data, offset);

    return buf;
  }

  byte_val(c) { return c.charCodeAt(0); }
}

// End of values.js

// Start of wrappers.js

// All of the functionality is in subclasses for the individual array types,
// which are generated into fields of the FutharkModule class
// (e.g. `fut.i32_1d` if `fut` is the FutharkModule instance).
// This is just used as a marker so we can check if some object is an instance
// of any of those generated classes.
class FutharkArray {
  constructor(name, arr, shape) {
    // Name is only for debugging since the debugger will show
    // 'FutharkArrayImpl' as type for all array types.
    this.type_name = name;
    this.arr = arr;
    this.shape = shape;
  }
}

function make_array_class(fut, name) {
  const type_info = fut.manifest.types[name];
  const prim_info = primInfos[type_info.elemtype];

  function wasm_fun(full_name) {
    const name = "_" + full_name;
    return fut.m[name];
  }
  
  return class FutharkArrayImpl extends FutharkArray {
    constructor(arr, shape) {
      super(name, arr, shape);
    }

    static from_native(arr) {
      const shape_fun = wasm_fun(type_info.ops.shape);
      const shape_ptr = shape_fun(fut.ctx, arr);
      
      const shape = new BigInt64Array(
        fut.m.HEAP64.subarray(shape_ptr / 8, shape_ptr / 8 + type_info.rank));

      return new FutharkArrayImpl(arr, shape);
    }

    static from_data(data, ...shape) {
      futhark_assert(shape.length == type_info.rank, "wrong number of shape arguments");
      if (typeof(shape[0]) === 'number') {
        shape = BigInt64Array.from(shape.map((x) => BigInt(x)));
      }

      if (data instanceof Array) {
        data = prim_info.create_array(data);
      }
      futhark_assert(data instanceof prim_info.array_type,
        "expected Array or correct TypedArray");

      const wasm_data = fut.malloc(data.byteLength);
      const wasm_view = fut.m.HEAPU8.subarray(wasm_data, wasm_data + data.byteLength);
      wasm_view.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));

      const new_fun = wasm_fun(type_info.ops.new);
      const arr = new_fun(fut.ctx, wasm_data, ...shape);

      fut.free(wasm_data);

      return new FutharkArrayImpl(arr, shape);
    }

    get_shape() { return this.shape; }

    async values() { 
      futhark_assert(this.arr != undefined, "array already freed");

      const flat_len = Number(this.shape.reduce((a, b) => a * b));
      const flat_size = flat_len * prim_info.size;
      const wasm_data = fut.malloc(flat_size);

      await fut.m.ccall(type_info.ops.values,
        'number', ['number', 'number', 'number'],
        [fut.ctx, this.arr, wasm_data],
        {async: true});

      const data = prim_info.create_array(
        prim_info.get_heap(fut.m)
          .subarray(wasm_data / prim_info.size,
                    wasm_data / prim_info.size + flat_len)
      );

      fut.free(wasm_data);

      return data;
    };

    free() {
      const free_fun = wasm_fun(type_info.ops.free);
      free_fun(fut.ctx, this.arr);
      this.arr = undefined;
    }
  };
}

function make_entry_function(fut, name) {
  const entry_info = fut.manifest.entry_points[name];
  
  return async function(...inputs) {
    futhark_assert(inputs.length == entry_info.inputs.length,
      "Unexpected number of input arguments");

    let real_inputs = [];

    for (let i = 0; i < inputs.length; i++) {
      const typ = entry_info.inputs[i].type;
      if (typ in primInfos) {
        real_inputs.push(primInfos[typ].scalar_type(inputs[i]));
      }
      else if (typ in fut.manifest.types) {
        const type_info = fut.manifest.types[typ];
        if (type_info.kind == "array") {
          if (!(inputs[i] instanceof FutharkArray)) {
            throw new Error("Entry point array arguments must be FutharkArrays");
          }
          real_inputs.push(inputs[i].arr);
        }
        else {
          real_inputs.push(inputs[i]);
        }
      }
      else {
        throw new Error("Unknown input type");
      }
    }

    let out_ptrs = [];
    for (let i = 0; i < entry_info.outputs.length; i++) {
      out_ptrs.push(fut.malloc(4));
    }

    await fut.m.ccall(entry_info.cfun, 'number',
      Array(1 + out_ptrs.length + real_inputs.length).fill('number'),
      [fut.ctx].concat(out_ptrs).concat(real_inputs), {async: true});

    let outputs = [];
    for (let i = 0; i < out_ptrs.length; i++) {
      const out_info = entry_info.outputs[i];
      if (out_info.type in primInfos) {
        const prim_info = primInfos[out_info.type];
        const val = prim_info.get_heap(fut.m)[out_ptrs[i] / prim_info.size];
        outputs.push(val);
      }
      else if (out_info.type in fut.manifest.types) {
        const type_info = fut.manifest.types[out_info.type];
        if (type_info.kind == "array") {
          const array_type = fut.types[out_info.type];
          const val = array_type.from_native(fut.m.HEAP32[out_ptrs[i] / 4]);
          outputs.push(val);
        }
        else {
          outputs.push(val);
        }
      }
      else {
        throw new Error("Unknown output type");
      }
    }

    for (const ptr of out_ptrs) {
      fut.free(ptr);
    }

    return outputs;
  };
}

// End of wrappers.js

class FutharkModule {
  constructor() {
    this.m = undefined;
    this.manifest = {"backend":"webgpu","entry_points":{"debug_esdt":{"cfun":"futhark_entry_debug_esdt","inputs":[{"name":"image","type":"[][]rgba","unique":false},{"name":"max_distance","type":"f32","unique":false}],"outputs":[{"type":"[]f32","unique":false}],"tuning_params":[]},"enhance_contrast_rgba":{"cfun":"futhark_entry_enhance_contrast_rgba","inputs":[{"name":"image_flat","type":"[]u8","unique":false},{"name":"width","type":"i64","unique":false},{"name":"height","type":"i64","unique":false},{"name":"target_contrast","type":"f32","unique":false},{"name":"max_distance","type":"f32","unique":false},{"name":"sample_distance","type":"f32","unique":false}],"outputs":[{"type":"[]u8","unique":false}],"tuning_params":[]},"test_grayscale":{"cfun":"futhark_entry_test_grayscale","inputs":[],"outputs":[{"type":"bool","unique":false}],"tuning_params":[]},"test_pipeline_passthrough":{"cfun":"futhark_entry_test_pipeline_passthrough","inputs":[],"outputs":[{"type":"bool","unique":false}],"tuning_params":[]}},"types":{"[][]rgba":{"ctype":"struct futhark_opaque_arr2d_rgba *","kind":"opaque","ops":{"free":"futhark_free_opaque_arr2d_rgba","restore":"futhark_restore_opaque_arr2d_rgba","store":"futhark_store_opaque_arr2d_rgba"},"record_array":{"elemtype":"rgba","fields":[{"name":"a","project":"futhark_project_opaque_arr2d_rgba_a","type":"[][]u8"},{"name":"b","project":"futhark_project_opaque_arr2d_rgba_b","type":"[][]u8"},{"name":"g","project":"futhark_project_opaque_arr2d_rgba_g","type":"[][]u8"},{"name":"r","project":"futhark_project_opaque_arr2d_rgba_r","type":"[][]u8"}],"index":"futhark_index_opaque_arr2d_rgba","rank":2,"shape":"futhark_shape_opaque_arr2d_rgba","zip":"futhark_zip_opaque_arr2d_rgba"}},"[][]u8":{"ctype":"struct futhark_u8_2d *","elemtype":"u8","kind":"array","ops":{"free":"futhark_free_u8_2d","index":"futhark_index_u8_2d","new":"futhark_new_u8_2d","new_raw":"futhark_new_raw_u8_2d","shape":"futhark_shape_u8_2d","values":"futhark_values_u8_2d","values_raw":"futhark_values_raw_u8_2d"},"rank":2},"[]f32":{"ctype":"struct futhark_f32_1d *","elemtype":"f32","kind":"array","ops":{"free":"futhark_free_f32_1d","index":"futhark_index_f32_1d","new":"futhark_new_f32_1d","new_raw":"futhark_new_raw_f32_1d","shape":"futhark_shape_f32_1d","values":"futhark_values_f32_1d","values_raw":"futhark_values_raw_f32_1d"},"rank":1},"[]u8":{"ctype":"struct futhark_u8_1d *","elemtype":"u8","kind":"array","ops":{"free":"futhark_free_u8_1d","index":"futhark_index_u8_1d","new":"futhark_new_u8_1d","new_raw":"futhark_new_raw_u8_1d","shape":"futhark_shape_u8_1d","values":"futhark_values_u8_1d","values_raw":"futhark_values_raw_u8_1d"},"rank":1},"rgba":{"ctype":"struct futhark_opaque_rgba *","kind":"opaque","ops":{"free":"futhark_free_opaque_rgba","restore":"futhark_restore_opaque_rgba","store":"futhark_store_opaque_rgba"},"record":{"fields":[{"name":"a","project":"futhark_project_opaque_rgba_a","type":"u8"},{"name":"b","project":"futhark_project_opaque_rgba_b","type":"u8"},{"name":"g","project":"futhark_project_opaque_rgba_g","type":"u8"},{"name":"r","project":"futhark_project_opaque_rgba_r","type":"u8"}],"new":"futhark_new_opaque_rgba"}}},"version":"0.26.0 (prerelease - include info below when reporting bugs).\ngit: webgpu-pr2140 @ 8369ad8 (Mon Aug 11 14:37:17 2025 +0200)\nCompiled with GHC 9.10.3.\n"};
  }
  async init(module) {
    this.m = module;
    this.cfg = this.m._futhark_context_config_new();
    this.ctx = await this.m.ccall('futhark_context_new', 'number', ['number'], [this.cfg], {async: true});
    this.entry = {};
    this.types = {};
    this.u8_1d = make_array_class(this, '[]u8');
    this.types['[]u8'] = this.u8_1d;
    this.u8_1d = make_array_class(this, '[]u8');
    this.types['[]u8'] = this.u8_1d;
    this.f32_1d = make_array_class(this, '[]f32');
    this.types['[]f32'] = this.f32_1d;
    this.entry['debug_esdt'] = make_entry_function(this, 'debug_esdt').bind(this);
    this.entry['enhance_contrast_rgba'] = make_entry_function(this, 'enhance_contrast_rgba').bind(this);
    this.entry['test_grayscale'] = make_entry_function(this, 'test_grayscale').bind(this);
    this.entry['test_pipeline_passthrough'] = make_entry_function(this, 'test_pipeline_passthrough').bind(this);
  }
  free() {
    this.m._futhark_context_free(this.ctx);
    this.m._futhark_context_config_free(this.cfg);
  }
  malloc(nbytes) {
    return this.m._malloc(nbytes);
  }
  free(ptr) {
    return this.m._free(ptr);
  }
  async context_sync() {
    return await this.m.ccall('futhark_context_sync', 'number', ['number'], [this.ctx], {async: true});
  }
  async clear_caches() {
    return await this.m.ccall('futhark_context_clear_caches', 'number', ['number'], [this.ctx], {async: true});
  }
  async report() {
    return await this.m.ccall('futhark_context_report', 'string',
      ['number'], [this.ctx], {async: true});
  }
  async pause_profiling() {
    return await this.m.ccall('futhark_context_pause_profiling', null, ['number'], [this.ctx], {async: true});
  }
  async unpause_profiling() {
    return await this.m.ccall('futhark_context_unpause_profiling', null, ['number'], [this.ctx], {async: true});
  }
}
// ESM export (added by just futhark-webgpu-compile)
export { FutharkModule, FutharkArray };
