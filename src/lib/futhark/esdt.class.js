// Start of server.js

class Server {

  constructor(ctx) {
    this.ctx = ctx;
    this._vars = {};
    this._types = {};
    this._commands = [ 'inputs',
                       'outputs',
                       'call',
                       'restore',
                       'store',
                       'free',
                       'clear',
                       'pause_profiling',
                       'unpause_profiling',
                       'report',
                       'rename'
                     ];
  }

  _get_arg(args, i) {
    if (i < args.length) {
      return args[i];
    } else {
      throw 'Insufficient command args';
    }
  }

  _get_entry_point(entry) {
    if (entry in this.ctx.get_entry_points()) {
      return this.ctx.get_entry_points()[entry];
    } else {
      throw "Unkown entry point: " + entry;
    }
  }

  _check_var(vname) {
    if (!(vname in this._vars)) {
      throw 'Unknown variable: ' + vname;
    }
  }

  _set_var(vname, v, t) {
    this._vars[vname] = v;
    this._types[vname] = t;
  }

  _get_type(vname) {
    this._check_var(vname);
    return this._types[vname];
  }

  _get_var(vname) {
    this._check_var(vname);
    return this._vars[vname];
  }

  _cmd_inputs(args) {
    var entry = this._get_arg(args, 0);
    var inputs = this._get_entry_point(entry)[1];
    for (var i = 0; i < inputs.length; i++) {
      console.log(inputs[i]);
    }
  }

  _cmd_outputs(args) {
    var entry = this._get_arg(args, 0);
    var outputs = this._get_entry_point(entry)[2];
    for (var i = 0; i < outputs.length; i++) {
      console.log(outputs[i]);
    }
  }

  _cmd_dummy(args) {
    // pass
  }

  _cmd_free(args) {
    for (var i = 0; i < args.length; i++) {
      var vname = args[i];
      this._check_var(vname);
      delete this._vars[vname];
    }
  }

  _cmd_rename(args) {
    var oldname = this._get_arg(args, 0)
    var newname = this._get_arg(args, 1)
    if (newname in this._vars) {
      throw "Variable already exists: " + newname;
    }
    this._vars[newname] = this._vars[oldname];
    this._types[newname] = this._types[oldname];
    delete this._vars[oldname];
    delete this._types[oldname];
  }

  _cmd_call(args) {
    var entry = this._get_entry_point(this._get_arg(args, 0));
    var num_ins = entry[1].length;
    var num_outs = entry[2].length;
    var expected_len = 1 + num_outs + num_ins

    if (args.length != expected_len) {
      throw "Invalid argument count, expected " + expected_len
    }

    var out_vnames = args.slice(1, num_outs+1)
    for (var i = 0; i < out_vnames.length; i++) {
      var out_vname = out_vnames[i];
      if (out_vname in this._vars) {
        throw "Variable already exists: " + out_vname;
      }
    }
    var in_vnames = args.slice(1+num_outs);
    var ins = [];
    for (var i = 0; i < in_vnames.length; i++) {
      ins.push(this._get_var(in_vnames[i]));
    }
    // Call entry point function from string name
    var bef = performance.now()*1000;
    var vals = this.ctx[entry[0]].apply(this.ctx, ins);
    var aft = performance.now()*1000;
    if (num_outs == 1) {
      this._set_var(out_vnames[0], vals, entry[2][0]);
    } else {
      for (var i = 0; i < out_vnames.length; i++) {
        this._set_var(out_vnames[i], vals[i], entry[2][i]);
      }
    }
    console.log("runtime: " + Math.round(aft-bef));
  }

  _cmd_store(args) {
    var fname = this._get_arg(args, 0);
    for (var i = 1; i < args.length; i++) {
      var vname = args[i];
      var value = this._get_var(vname);
      var typ = this._get_type(vname);
      var fs = require("fs");
      var bin_val = construct_binary_value(value, typ);
      fs.appendFileSync(fname, bin_val, 'binary')
    }
  }

  fut_to_dim_typ(typ) {
    var type = typ;
    var count = 0;
    while (type.substr(0, 2) == '[]') {
      count = count + 1;
      type = type.slice(2);
    }
    return [count, type];
  }

  _cmd_restore(args) {
    if (args.length % 2 == 0) {
      throw "Invalid argument count";
    }

    var fname = args[0];
    var args = args.slice(1);

    var as = args;
    var reader = new Reader(fname);
    while (as.length != 0) {
      var vname = as[0];
      var typename = as[1];
      as = as.slice(2);

      if (vname in this._vars) {
        throw "Variable already exists: " + vname;
      }
      try {
        var value = read_value(typename, reader);
        if (typeof value == 'number' || typeof value == 'bigint') {
          this._set_var(vname, value, typename);
        } else {
          // We are working with an array and need to create to convert [shape, arr] to futhark ptr
          var shape= value[0];
          var arr = value[1];
          var dimtyp = this.fut_to_dim_typ(typename);
          var dim = dimtyp[0];
          var typ = dimtyp[1];
          var arg_list = [arr, ...shape];
          var fnam = "new_" + typ + "_" + dim + "d";
          var ptr = this.ctx[fnam].apply(this.ctx, arg_list);
          this._set_var(vname, ptr, typename);
        }
      } catch (err) {
        var err_msg = "Failed to restore variable " + vname + ".\nPossibly malformed data in " + fname + ".\n" + err.toString();
        throw err_msg;
      }
    }
    skip_spaces(reader);
    if (reader.get_buff().length != 0) {
      throw "Expected EOF after reading values";
    }
  }

  _process_line(line) {
    // TODO make sure it splits on anywhite space
    var words = line.split(" ");
    if (words.length == 0) {
      throw "Empty line";
    } else {
      var cmd = words[0];
      var args = words.splice(1);
      if (this._commands.includes(cmd)) {
        switch (cmd) {
        case 'inputs': this._cmd_inputs(args); break;
        case 'outputs': this._cmd_outputs(args); break
        case 'call': this._cmd_call(args); break
        case 'restore': this._cmd_restore(args); break
        case 'store': this._cmd_store(args); break
        case 'free': this._cmd_free(args); break
        case 'clear': this._cmd_dummy(args); break
        case 'pause_profiling': this._cmd_dummy(args); break
        case 'unpause_profiling': this._cmd_dummy(args); break
        case 'report': this._cmd_dummy(args); break
        case 'rename': this._cmd_rename(args); break
        }
      } else {
        throw "Unknown command: " + cmd;
      }
    }
  }

  run() {
    console.log('%%% OK'); // TODO figure out if flushing is neccesary for JS
    const readline = require('readline');
    const rl = readline.createInterface(process.stdin);
    rl.on('line', (line) => {
      if (line == "") {
        rl.close();
      }
      try {
        this._process_line(line);
        console.log('%%% OK');
      } catch (err) {
        console.log('%%% FAILURE');
        console.log(err);
        console.log('%%% OK');
      }
    }).on('close', () => { process.exit(0); });
  }
}

// End of server.js

// Start of values.js
var futharkPrimtypes =
  new Set([
    'i8',
    'i16',
    'i32',
    'i64',
    'u8',
    'u16',
    'u32',
    'u64',
    'f16',
    'f32',
    'f64',
    'bool']);


var typToType = { '  i8' : Int8Array ,
                  ' i16' : Int16Array ,
                  ' i32' : Int32Array ,
                  ' i64' : BigInt64Array ,
                  '  u8' : Uint8Array ,
                  ' u16' : Uint16Array ,
                  ' u32' : Uint32Array ,
                  ' u64' : BigUint64Array ,
                  ' f16' : Uint16Array ,
                  ' f32' : Float32Array ,
                  ' f64' : Float64Array ,
                  'bool' : Uint8Array
                };

function binToStringArray(buff, array) {
  for (var i = 0; i < array.length; i++) {
    array[i] = buff[i];
  }
}

function fileToBuff(fname) {
  var readline = require('readline');
  var fs = require('fs');
  var buff =  fs.readFileSync(fname);
  return buff;
}

var typToSize = {
  "bool" : 1,
  "  u8" : 1,
  "  i8" : 1,
  " u16" : 2,
  " i16" : 2,
  " u32" : 4,
  " i32" : 4,
  " f16" : 2,
  " f32" : 4,
  " u64" : 8,
  " i64" : 8,
  " f64" : 8,
}

function toU8(ta) {
  return new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);
}

function construct_binary_value(v, typ) {
  var dims;
  var payload_bytes;
  var filler;
  if (v instanceof FutharkOpaque) {
    throw "Opaques are not supported";
  } else if (v instanceof FutharkArray) {
    var t = v.futharkType();
    var ftype = "    ".slice(t.length) + t;
    var shape = v.shape();
    var ta = v.toTypedArray(shape);
    var da = new BigInt64Array(shape);
    dims = shape.length;
    payload_bytes = da.byteLength + ta.byteLength;
    filler = (bytes) => {
      bytes.set(toU8(da), 7);
      bytes.set(toU8(ta), 7 + da.byteLength);
    }
  } else {
    var ftype = "    ".slice(typ.length) + typ;
    dims = 0;
    payload_bytes = typToSize[ftype];
    filler = (bytes) => {
      var scalar = new (typToType[ftype])([v]);
      bytes.set(toU8(scalar), 7);
    }
  }
  var total_bytes = 7 + payload_bytes;
  var bytes = new Uint8Array(total_bytes);
  bytes[0] = Buffer.from('b').readUInt8();
  bytes[1] = 2;
  bytes[2] = dims;
  for (var i = 0; i < 4; i++) {
    bytes[3+i] = ftype.charCodeAt(i);
  }
  filler(bytes);
  return Buffer.from(bytes);
}

class Reader {
  constructor(f) {
    this.f = f;
    this.buff = fileToBuff(f);
  }

  read_bin_array(num_dim, typ) {
    var u8_array = new Uint8Array(num_dim * 8);
    binToStringArray(this.buff.slice(0, num_dim * 8), u8_array);
    var shape = new BigInt64Array(u8_array.buffer);
    var length = shape[0];
    for (var i = 1; i < shape.length; i++) {
      length = length * shape[i];
    }
    length = Number(length);
    var dbytes = typToSize[typ];
    var u8_data = new Uint8Array(length * dbytes);
    binToStringArray(this.buff.slice(num_dim * 8, num_dim * 8 + dbytes * length), u8_data);
    var data  = new (typToType[typ])(u8_data.buffer);
    var tmp_buff = this.buff.slice(num_dim * 8, num_dim * 8 + dbytes * length);
    this.buff = this.buff.slice(num_dim * 8 + dbytes * length);
   return [shape, data];
  }

  read_bin_scalar(typ) {
    var size = typToSize[typ];
    var u8_array = new Uint8Array(size);
    binToStringArray(this.buff, u8_array);
    var array = new (typToType[typ])(u8_array.buffer);
    this.buff = this.buff.slice(u8_array.length); // Update buff to be unread part of the string
    return array[0];
  }

  skip_spaces() {
    while (this.buff.length > 0 && this.buff.slice(0, 1).toString().trim() == "") {
      this.buff = this.buff.slice(1);
    }
  }

  read_binary(typename, dim) {
    // Skip leading white space
    while (this.buff.slice(0, 1).toString().trim() == "") {
      this.buff = this.buff.slice(1);
    }
    if (this.buff[0] != 'b'.charCodeAt(0)) {
      throw "Not in binary format"
    }
    var version = this.buff[1];
    if (version != 2) {
      throw "Not version 2";
    }
    var num_dim = this.buff[2];
    var typ = this.buff.slice(3, 7);
    this.buff = this.buff.slice(7);
    var exp_typ = "[]".repeat(dim) + typename;
    var given_typ = "[]".repeat(num_dim) + typ.toString().trim();
    console.log(exp_typ);
    console.log(given_typ);
    if (exp_typ !== given_typ) {
      throw ("Expected type : " + exp_typ + ", Actual type : " + given_typ);
    }
    if (num_dim === 0) {
      return this.read_bin_scalar(typ);
    } else {
      return this.read_bin_array(num_dim, typ);
    }
  }

  get_buff() {
    return this.buff;
  }
}

// Function is redudant but is helpful for keeping consistent with python implementation
function skip_spaces(reader) {
  reader.skip_spaces();
}

function read_value(typename, reader) {
  var typ = typename;
  var dim = 0;
  while (typ.slice(0, 2) === "[]") {
    dim = dim + 1;
    typ = typ.slice(2);
  }
  if (!futharkPrimtypes.has(typ)) {
    throw ("Unkown type: " + typ);
  }

  var val = reader.read_binary(typ, dim);
  return val;
}

// End of values.js

// Start of wrapperclasses.js

class FutharkArray {
  constructor(ctx, ptr, type_name, dim, heap, fshape, fvalues, ffree) {
    this.ctx = ctx;
    this.ptr = ptr;
    this.type_name = type_name;
    this.dim = dim;
    this.heap = heap;
    this.fshape = fshape;
    this.fvalues = fvalues;
    this.ffree = ffree;
    this.valid = true;
  }

  validCheck() {
    if (!this.valid) {
      throw "Using freed memory"
    }
  }

  futharkType() {
    return this.type_name;
  }

  free() {
    this.validCheck();
    this.ffree(this.ctx.ctx, this.ptr);
    this.valid = false;
  }

  shape() {
    this.validCheck();
    var s = this.fshape(this.ctx.ctx, this.ptr) >> 3;
    return Array.from(this.ctx.wasm.HEAP64.subarray(s, s + this.dim));
  }

  toTypedArray(dims = this.shape()) {
    this.validCheck();
    console.assert(dims.length === this.dim, "dim=%s,dims=%s", this.dim, dims.toString());
    var length = Number(dims.reduce((a, b) => a * b));
    var v = this.fvalues(this.ctx.ctx, this.ptr) / this.heap.BYTES_PER_ELEMENT;
    return this.heap.subarray(v, v + length);
  }

  toArray() {
    this.validCheck();
    var dims = this.shape();
    var ta = this.toTypedArray(dims);
    return (function nest(offs, ds) {
      var d0 = Number(ds[0]);
      if (ds.length === 1) {
        return Array.from(ta.subarray(offs, offs + d0));
      } else {
        var d1 = Number(ds[1]);
        return Array.from(Array(d0), (x,i) => nest(offs + i * d1, ds.slice(1)));
      }
    })(0, dims);
  }
}

class FutharkOpaque {
  constructor(ctx, ptr, ffree) {
    this.ctx = ctx;
    this.ptr = ptr;
    this.ffree = ffree;
    this.valid = true;
  }

  validCheck() {
    if (!this.valid) {
      throw "Using freed memory"
    }
  }

  free() {
    this.validCheck();
    this.ffree(this.ctx.ctx, this.ptr);
    this.valid = false;
  }
}

// End of wrapperclasses.js

class FutharkContext {
constructor(wasm, num_threads) {
  this.wasm = wasm;
  this.cfg = this.wasm._futhark_context_config_new();
  if (num_threads) this.wasm._futhark_context_config_set_num_threads(this.cfg, num_threads);
  this.ctx = this.wasm._futhark_context_new(this.cfg);
  this.entry_points = {
    "compute_esdt_2d" : ["compute_esdt_2d", ["[][]f32","bool"], ["[]f32"]],"get_distance_at" : ["get_distance_at", ["[]f32","i64","i64","i64"], ["f32"]],"test_edge_weight" : ["test_edge_weight", [], ["bool"]],"test_horizontal_line" : ["test_horizontal_line", [], ["bool"]],"test_single_point" : ["test_single_point", [], ["bool"]]
  };
}
free() {
  this.wasm._futhark_context_free(this.ctx);
  this.wasm._futhark_context_config_free(this.cfg);
}
get_entry_points() {
  return this.entry_points;
}
get_error() {
  var ptr = this.wasm._futhark_context_get_error(this.ctx);
  var len = HEAP8.subarray(ptr).indexOf(0);
  var str = String.fromCharCode(...HEAP8.subarray(ptr, ptr + len));
  this.wasm._free(ptr);
  return str;
}
new_f32_2d_from_jsarray(array2d) {
  return this.new_f32_2d(array2d.flat(), array2d.length, array2d[0].length);
}
new_f32_2d(array, d0, d1) {
  console.assert(array.length === Number(d0)*Number(d1), 'len=%s,dims=%s', array.length, [d0, d1].toString());
    var copy = this.wasm._malloc(array.length << 2);
    this.wasm.HEAPF32.set(array, copy >> 2);
    var ptr = this.wasm._futhark_new_f32_2d(this.ctx, copy, BigInt(d0), BigInt(d1));
    this.wasm._free(copy);
    return this.new_f32_2d_from_ptr(ptr);
  }

  new_f32_2d_from_ptr(ptr) {
    return new FutharkArray(this, ptr, 'f32', 2, this.wasm.HEAPF32, this.wasm._futhark_shape_f32_2d, this.wasm._futhark_values_raw_f32_2d, this.wasm._futhark_free_f32_2d);
  }
new_f32_1d_from_jsarray(array1d) {
  return this.new_f32_1d(array1d, array1d.length);
}
new_f32_1d(array, d0) {
  console.assert(array.length === Number(d0), 'len=%s,dims=%s', array.length, [d0].toString());
    var copy = this.wasm._malloc(array.length << 2);
    this.wasm.HEAPF32.set(array, copy >> 2);
    var ptr = this.wasm._futhark_new_f32_1d(this.ctx, copy, BigInt(d0));
    this.wasm._free(copy);
    return this.new_f32_1d_from_ptr(ptr);
  }

  new_f32_1d_from_ptr(ptr) {
    return new FutharkArray(this, ptr, 'f32', 1, this.wasm.HEAPF32, this.wasm._futhark_shape_f32_1d, this.wasm._futhark_values_raw_f32_1d, this.wasm._futhark_free_f32_1d);
  }

compute_esdt_2d(in0, in1) {
  var out = [4].map(n => this.wasm._malloc(n));
  var to_free = [];
  var do_free = () => { out.forEach(this.wasm._free); to_free.forEach(f => f.free()); };
    if (in0 instanceof Array) { in0 = this.new_f32_2d_from_jsarray(in0); to_free.push(in0); }
  if (this.wasm._futhark_entry_compute_esdt_2d(this.ctx, ...out, in0.ptr, in1) > 0) {
    do_free();
    throw this.get_error();
  }
    var result0 = this.new_f32_1d_from_ptr(this.wasm.HEAP32[out[0] >> 2]);
  do_free();
  return result0;
}
get_distance_at(in0, in1, in2, in3) {
  var out = [4].map(n => this.wasm._malloc(n));
  var to_free = [];
  var do_free = () => { out.forEach(this.wasm._free); to_free.forEach(f => f.free()); };
    if (in0 instanceof Array) { in0 = this.new_f32_1d_from_jsarray(in0); to_free.push(in0); }
  if (this.wasm._futhark_entry_get_distance_at(this.ctx, ...out, in0.ptr, in1, in2, in3) > 0) {
    do_free();
    throw this.get_error();
  }
    var result0 = this.wasm.HEAPF32[out[0] >> 2];
  do_free();
  return result0;
}
test_edge_weight() {
  var out = [1].map(n => this.wasm._malloc(n));
  var to_free = [];
  var do_free = () => { out.forEach(this.wasm._free); to_free.forEach(f => f.free()); };
  
  if (this.wasm._futhark_entry_test_edge_weight(this.ctx, ...out, ) > 0) {
    do_free();
    throw this.get_error();
  }
    var result0 = this.wasm.HEAP8[out[0] >> 0]!==0;
  do_free();
  return result0;
}
test_horizontal_line() {
  var out = [1].map(n => this.wasm._malloc(n));
  var to_free = [];
  var do_free = () => { out.forEach(this.wasm._free); to_free.forEach(f => f.free()); };
  
  if (this.wasm._futhark_entry_test_horizontal_line(this.ctx, ...out, ) > 0) {
    do_free();
    throw this.get_error();
  }
    var result0 = this.wasm.HEAP8[out[0] >> 0]!==0;
  do_free();
  return result0;
}
test_single_point() {
  var out = [1].map(n => this.wasm._malloc(n));
  var to_free = [];
  var do_free = () => { out.forEach(this.wasm._free); to_free.forEach(f => f.free()); };
  
  if (this.wasm._futhark_entry_test_single_point(this.ctx, ...out, ) > 0) {
    do_free();
    throw this.get_error();
  }
    var result0 = this.wasm.HEAP8[out[0] >> 0]!==0;
  do_free();
  return result0;
}

}
async function newFutharkContext() {
  var wasm = await loadWASM();
  return new FutharkContext(wasm);
}

export {newFutharkContext, FutharkContext, FutharkArray, FutharkOpaque};