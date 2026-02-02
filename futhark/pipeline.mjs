async function loadWASM(moduleArg={}){var moduleRtn;var Module=moduleArg;var ENVIRONMENT_IS_WEB=!!globalThis.window;var ENVIRONMENT_IS_WORKER=!!globalThis.WorkerGlobalScope;var ENVIRONMENT_IS_NODE=globalThis.process?.versions?.node&&globalThis.process?.type!="renderer";var ENVIRONMENT_IS_PTHREAD=ENVIRONMENT_IS_WORKER&&self.name?.startsWith("em-pthread");if(ENVIRONMENT_IS_NODE){const{createRequire}=await import("module");var require=createRequire(import.meta.url);var worker_threads=require("worker_threads");global.Worker=worker_threads.Worker;ENVIRONMENT_IS_WORKER=!worker_threads.isMainThread;ENVIRONMENT_IS_PTHREAD=ENVIRONMENT_IS_WORKER&&worker_threads["workerData"]=="em-pthread"}var arguments_=[];var thisProgram="./this.program";var quit_=(status,toThrow)=>{throw toThrow};var _scriptName=import.meta.url;var scriptDirectory="";function locateFile(path){if(Module["locateFile"]){return Module["locateFile"](path,scriptDirectory)}return scriptDirectory+path}var readAsync,readBinary;if(ENVIRONMENT_IS_NODE){var fs=require("fs");if(_scriptName.startsWith("file:")){scriptDirectory=require("path").dirname(require("url").fileURLToPath(_scriptName))+"/"}readBinary=filename=>{filename=isFileURI(filename)?new URL(filename):filename;var ret=fs.readFileSync(filename);return ret};readAsync=async(filename,binary=true)=>{filename=isFileURI(filename)?new URL(filename):filename;var ret=fs.readFileSync(filename,binary?undefined:"utf8");return ret};if(process.argv.length>1){thisProgram=process.argv[1].replace(/\\/g,"/")}arguments_=process.argv.slice(2);quit_=(status,toThrow)=>{process.exitCode=status;throw toThrow}}else if(ENVIRONMENT_IS_WEB||ENVIRONMENT_IS_WORKER){try{scriptDirectory=new URL(".",_scriptName).href}catch{}if(!ENVIRONMENT_IS_NODE){if(ENVIRONMENT_IS_WORKER){readBinary=url=>{var xhr=new XMLHttpRequest;xhr.open("GET",url,false);xhr.responseType="arraybuffer";xhr.send(null);return new Uint8Array(xhr.response)}}readAsync=async url=>{if(isFileURI(url)){return new Promise((resolve,reject)=>{var xhr=new XMLHttpRequest;xhr.open("GET",url,true);xhr.responseType="arraybuffer";xhr.onload=()=>{if(xhr.status==200||xhr.status==0&&xhr.response){resolve(xhr.response);return}reject(xhr.status)};xhr.onerror=reject;xhr.send(null)})}var response=await fetch(url,{credentials:"same-origin"});if(response.ok){return response.arrayBuffer()}throw new Error(response.status+" : "+response.url)}}}else{}var defaultPrint=console.log.bind(console);var defaultPrintErr=console.error.bind(console);if(ENVIRONMENT_IS_NODE){var utils=require("util");var stringify=a=>typeof a=="object"?utils.inspect(a):a;defaultPrint=(...args)=>fs.writeSync(1,args.map(stringify).join(" ")+"\n");defaultPrintErr=(...args)=>fs.writeSync(2,args.map(stringify).join(" ")+"\n")}var out=defaultPrint;var err=defaultPrintErr;var wasmBinary;var wasmModule;var ABORT=false;var EXITSTATUS;var isFileURI=filename=>filename.startsWith("file://");var readyPromiseResolve,readyPromiseReject;if(ENVIRONMENT_IS_NODE&&ENVIRONMENT_IS_PTHREAD){var parentPort=worker_threads["parentPort"];parentPort.on("message",msg=>global.onmessage?.({data:msg}));Object.assign(globalThis,{self:global,postMessage:msg=>parentPort["postMessage"](msg)});process.on("uncaughtException",err=>{postMessage({cmd:"uncaughtException",error:err});process.exit(1)})}var startWorker;if(ENVIRONMENT_IS_PTHREAD){var initializedJS=false;self.onunhandledrejection=e=>{throw e.reason||e};function handleMessage(e){try{var msgData=e["data"];var cmd=msgData.cmd;if(cmd==="load"){let messageQueue=[];self.onmessage=e=>messageQueue.push(e);startWorker=()=>{postMessage({cmd:"loaded"});for(let msg of messageQueue){handleMessage(msg)}self.onmessage=handleMessage};for(const handler of msgData.handlers){if(!Module[handler]||Module[handler].proxy){Module[handler]=(...args)=>{postMessage({cmd:"callHandler",handler,args})};if(handler=="print")out=Module[handler];if(handler=="printErr")err=Module[handler]}}wasmMemory=msgData.wasmMemory;updateMemoryViews();wasmModule=msgData.wasmModule;createWasm();run()}else if(cmd==="run"){establishStackSpace(msgData.pthread_ptr);__emscripten_thread_init(msgData.pthread_ptr,0,0,1,0,0);PThread.threadInitTLS();__emscripten_thread_mailbox_await(msgData.pthread_ptr);if(!initializedJS){initializedJS=true}try{invokeEntryPoint(msgData.start_routine,msgData.arg)}catch(ex){if(ex!="unwind"){throw ex}}}else if(msgData.target==="setimmediate"){}else if(cmd==="checkMailbox"){if(initializedJS){checkMailbox()}}else if(cmd){err(`worker: received unknown command ${cmd}`);err(msgData)}}catch(ex){__emscripten_thread_crashed();throw ex}}self.onmessage=handleMessage}var HEAP8,HEAPU8,HEAP16,HEAPU16,HEAP32,HEAPU32,HEAPF32,HEAPF64;var HEAP64,HEAPU64;var runtimeInitialized=false;function updateMemoryViews(){var b=wasmMemory.buffer;HEAP8=new Int8Array(b);HEAP16=new Int16Array(b);HEAPU8=new Uint8Array(b);HEAPU16=new Uint16Array(b);HEAP32=new Int32Array(b);HEAPU32=new Uint32Array(b);HEAPF32=new Float32Array(b);HEAPF64=new Float64Array(b);HEAP64=new BigInt64Array(b);HEAPU64=new BigUint64Array(b)}function initMemory(){if(ENVIRONMENT_IS_PTHREAD){return}if(Module["wasmMemory"]){wasmMemory=Module["wasmMemory"]}else{var INITIAL_MEMORY=Module["INITIAL_MEMORY"]||16777216;wasmMemory=new WebAssembly.Memory({initial:INITIAL_MEMORY/65536,maximum:INITIAL_MEMORY/65536,shared:true})}updateMemoryViews()}function preRun(){if(Module["preRun"]){if(typeof Module["preRun"]=="function")Module["preRun"]=[Module["preRun"]];while(Module["preRun"].length){addOnPreRun(Module["preRun"].shift())}}callRuntimeCallbacks(onPreRuns)}function initRuntime(){runtimeInitialized=true;if(ENVIRONMENT_IS_PTHREAD)return startWorker();wasmExports["u"]()}function postRun(){if(ENVIRONMENT_IS_PTHREAD){return}if(Module["postRun"]){if(typeof Module["postRun"]=="function")Module["postRun"]=[Module["postRun"]];while(Module["postRun"].length){addOnPostRun(Module["postRun"].shift())}}callRuntimeCallbacks(onPostRuns)}function abort(what){Module["onAbort"]?.(what);what="Aborted("+what+")";err(what);ABORT=true;what+=". Build with -sASSERTIONS for more info.";var e=new WebAssembly.RuntimeError(what);readyPromiseReject?.(e);throw e}var wasmBinaryFile;function findWasmBinary(){if(Module["locateFile"]){return locateFile("pipeline.wasm")}return new URL("pipeline.wasm",import.meta.url).href}function getBinarySync(file){if(file==wasmBinaryFile&&wasmBinary){return new Uint8Array(wasmBinary)}if(readBinary){return readBinary(file)}throw"both async and sync fetching of the wasm failed"}async function getWasmBinary(binaryFile){if(!wasmBinary){try{var response=await readAsync(binaryFile);return new Uint8Array(response)}catch{}}return getBinarySync(binaryFile)}async function instantiateArrayBuffer(binaryFile,imports){try{var binary=await getWasmBinary(binaryFile);var instance=await WebAssembly.instantiate(binary,imports);return instance}catch(reason){err(`failed to asynchronously prepare wasm: ${reason}`);abort(reason)}}async function instantiateAsync(binary,binaryFile,imports){if(!binary&&!isFileURI(binaryFile)&&!ENVIRONMENT_IS_NODE){try{var response=fetch(binaryFile,{credentials:"same-origin"});var instantiationResult=await WebAssembly.instantiateStreaming(response,imports);return instantiationResult}catch(reason){err(`wasm streaming compile failed: ${reason}`);err("falling back to ArrayBuffer instantiation")}}return instantiateArrayBuffer(binaryFile,imports)}function getWasmImports(){assignWasmImports();var imports={a:wasmImports};return imports}async function createWasm(){function receiveInstance(instance,module){wasmExports=instance.exports;registerTLSInit(wasmExports["T"]);assignWasmExports(wasmExports);wasmModule=module;return wasmExports}function receiveInstantiationResult(result){return receiveInstance(result["instance"],result["module"])}var info=getWasmImports();if(Module["instantiateWasm"]){return new Promise((resolve,reject)=>{Module["instantiateWasm"](info,(inst,mod)=>{resolve(receiveInstance(inst,mod))})})}if(ENVIRONMENT_IS_PTHREAD){var instance=new WebAssembly.Instance(wasmModule,getWasmImports());return receiveInstance(instance,wasmModule)}wasmBinaryFile??=findWasmBinary();var result=await instantiateAsync(wasmBinary,wasmBinaryFile,info);var exports=receiveInstantiationResult(result);return exports}class ExitStatus{name="ExitStatus";constructor(status){this.message=`Program terminated with exit(${status})`;this.status=status}}var terminateWorker=worker=>{worker.terminate();worker.onmessage=e=>{}};var cleanupThread=pthread_ptr=>{var worker=PThread.pthreads[pthread_ptr];PThread.returnWorkerToPool(worker)};var callRuntimeCallbacks=callbacks=>{while(callbacks.length>0){callbacks.shift()(Module)}};var onPreRuns=[];var addOnPreRun=cb=>onPreRuns.push(cb);var spawnThread=threadParams=>{var worker=PThread.getNewWorker();if(!worker){return 6}PThread.runningWorkers.push(worker);PThread.pthreads[threadParams.pthread_ptr]=worker;worker.pthread_ptr=threadParams.pthread_ptr;var msg={cmd:"run",start_routine:threadParams.startRoutine,arg:threadParams.arg,pthread_ptr:threadParams.pthread_ptr};if(ENVIRONMENT_IS_NODE){worker.unref()}worker.postMessage(msg,threadParams.transferList);return 0};var runtimeKeepaliveCounter=0;var keepRuntimeAlive=()=>noExitRuntime||runtimeKeepaliveCounter>0;var stackSave=()=>_emscripten_stack_get_current();var stackRestore=val=>__emscripten_stack_restore(val);var stackAlloc=sz=>__emscripten_stack_alloc(sz);var proxyToMainThread=(funcIndex,emAsmAddr,sync,...callArgs)=>{var bufSize=8*callArgs.length*2;var sp=stackSave();var args=stackAlloc(bufSize);var b=args>>3;for(var arg of callArgs){if(typeof arg=="bigint"){HEAP64[b++]=1n;HEAP64[b++]=arg}else{HEAP64[b++]=0n;HEAPF64[b++]=arg}}var rtn=__emscripten_run_js_on_main_thread(funcIndex,emAsmAddr,bufSize,args,sync);stackRestore(sp);return rtn};function _proc_exit(code){if(ENVIRONMENT_IS_PTHREAD)return proxyToMainThread(0,0,1,code);EXITSTATUS=code;if(!keepRuntimeAlive()){PThread.terminateAllThreads();Module["onExit"]?.(code);ABORT=true}quit_(code,new ExitStatus(code))}function exitOnMainThread(returnCode){if(ENVIRONMENT_IS_PTHREAD)return proxyToMainThread(1,0,0,returnCode);_exit(returnCode)}var exitJS=(status,implicit)=>{EXITSTATUS=status;if(ENVIRONMENT_IS_PTHREAD){exitOnMainThread(status);throw"unwind"}_proc_exit(status)};var _exit=exitJS;var PThread={unusedWorkers:[],runningWorkers:[],tlsInitFunctions:[],pthreads:{},init(){if(!ENVIRONMENT_IS_PTHREAD){PThread.initMainThread()}},initMainThread(){},terminateAllThreads:()=>{for(var worker of PThread.runningWorkers){terminateWorker(worker)}for(var worker of PThread.unusedWorkers){terminateWorker(worker)}PThread.unusedWorkers=[];PThread.runningWorkers=[];PThread.pthreads={}},returnWorkerToPool:worker=>{var pthread_ptr=worker.pthread_ptr;delete PThread.pthreads[pthread_ptr];PThread.unusedWorkers.push(worker);PThread.runningWorkers.splice(PThread.runningWorkers.indexOf(worker),1);worker.pthread_ptr=0;__emscripten_thread_free_data(pthread_ptr)},threadInitTLS(){PThread.tlsInitFunctions.forEach(f=>f())},loadWasmModuleToWorker:worker=>new Promise(onFinishedLoading=>{worker.onmessage=e=>{var d=e["data"];var cmd=d.cmd;if(d.targetThread&&d.targetThread!=_pthread_self()){var targetWorker=PThread.pthreads[d.targetThread];if(targetWorker){targetWorker.postMessage(d,d.transferList)}else{err(`Internal error! Worker sent a message "${cmd}" to target pthread ${d.targetThread}, but that thread no longer exists!`)}return}if(cmd==="checkMailbox"){checkMailbox()}else if(cmd==="spawnThread"){spawnThread(d)}else if(cmd==="cleanupThread"){callUserCallback(()=>cleanupThread(d.thread))}else if(cmd==="loaded"){worker.loaded=true;onFinishedLoading(worker)}else if(d.target==="setimmediate"){worker.postMessage(d)}else if(cmd==="uncaughtException"){worker.onerror(d.error)}else if(cmd==="callHandler"){Module[d.handler](...d.args)}else if(cmd){err(`worker sent an unknown command ${cmd}`)}};worker.onerror=e=>{var message="worker sent an error!";err(`${message} ${e.filename}:${e.lineno}: ${e.message}`);throw e};if(ENVIRONMENT_IS_NODE){worker.on("message",data=>worker.onmessage({data}));worker.on("error",e=>worker.onerror(e))}var handlers=[];var knownHandlers=["onExit","onAbort","print","printErr"];for(var handler of knownHandlers){if(Module.propertyIsEnumerable(handler)){handlers.push(handler)}}worker.postMessage({cmd:"load",handlers,wasmMemory,wasmModule})}),allocateUnusedWorker(){var worker;if(Module["mainScriptUrlOrBlob"]){var pthreadMainJs=Module["mainScriptUrlOrBlob"];if(typeof pthreadMainJs!="string"){pthreadMainJs=URL.createObjectURL(pthreadMainJs)}worker=new Worker(pthreadMainJs,{type:"module",workerData:"em-pthread",name:"em-pthread"})}else worker=new Worker(new URL("pipeline.mjs",import.meta.url),{type:"module",workerData:"em-pthread",name:"em-pthread"});PThread.unusedWorkers.push(worker)},getNewWorker(){if(PThread.unusedWorkers.length==0){PThread.allocateUnusedWorker();PThread.loadWasmModuleToWorker(PThread.unusedWorkers[0])}return PThread.unusedWorkers.pop()}};var onPostRuns=[];var addOnPostRun=cb=>onPostRuns.push(cb);function establishStackSpace(pthread_ptr){var stackHigh=HEAPU32[pthread_ptr+52>>2];var stackSize=HEAPU32[pthread_ptr+56>>2];var stackLow=stackHigh-stackSize;_emscripten_stack_set_limits(stackHigh,stackLow);stackRestore(stackHigh)}var wasmTableMirror=[];var getWasmTableEntry=funcPtr=>{var func=wasmTableMirror[funcPtr];if(!func){wasmTableMirror[funcPtr]=func=wasmTable.get(funcPtr)}return func};var invokeEntryPoint=(ptr,arg)=>{runtimeKeepaliveCounter=0;noExitRuntime=0;var result=getWasmTableEntry(ptr)(arg);function finish(result){if(keepRuntimeAlive()){EXITSTATUS=result;return}__emscripten_thread_exit(result)}finish(result)};var noExitRuntime=true;var registerTLSInit=tlsInitFunc=>PThread.tlsInitFunctions.push(tlsInitFunc);var wasmMemory;var UTF8Decoder=globalThis.TextDecoder&&new TextDecoder;var findStringEnd=(heapOrArray,idx,maxBytesToRead,ignoreNul)=>{var maxIdx=idx+maxBytesToRead;if(ignoreNul)return maxIdx;while(heapOrArray[idx]&&!(idx>=maxIdx))++idx;return idx};var UTF8ArrayToString=(heapOrArray,idx=0,maxBytesToRead,ignoreNul)=>{var endPtr=findStringEnd(heapOrArray,idx,maxBytesToRead,ignoreNul);if(endPtr-idx>16&&heapOrArray.buffer&&UTF8Decoder){return UTF8Decoder.decode(heapOrArray.buffer instanceof ArrayBuffer?heapOrArray.subarray(idx,endPtr):heapOrArray.slice(idx,endPtr))}var str="";while(idx<endPtr){var u0=heapOrArray[idx++];if(!(u0&128)){str+=String.fromCharCode(u0);continue}var u1=heapOrArray[idx++]&63;if((u0&224)==192){str+=String.fromCharCode((u0&31)<<6|u1);continue}var u2=heapOrArray[idx++]&63;if((u0&240)==224){u0=(u0&15)<<12|u1<<6|u2}else{u0=(u0&7)<<18|u1<<12|u2<<6|heapOrArray[idx++]&63}if(u0<65536){str+=String.fromCharCode(u0)}else{var ch=u0-65536;str+=String.fromCharCode(55296|ch>>10,56320|ch&1023)}}return str};var UTF8ToString=(ptr,maxBytesToRead,ignoreNul)=>ptr?UTF8ArrayToString(HEAPU8,ptr,maxBytesToRead,ignoreNul):"";var ___assert_fail=(condition,filename,line,func)=>abort(`Assertion failed: ${UTF8ToString(condition)}, at: `+[filename?UTF8ToString(filename):"unknown filename",line,func?UTF8ToString(func):"unknown function"]);function pthreadCreateProxied(pthread_ptr,attr,startRoutine,arg){if(ENVIRONMENT_IS_PTHREAD)return proxyToMainThread(2,0,1,pthread_ptr,attr,startRoutine,arg);return ___pthread_create_js(pthread_ptr,attr,startRoutine,arg)}var _emscripten_has_threading_support=()=>!!globalThis.SharedArrayBuffer;var ___pthread_create_js=(pthread_ptr,attr,startRoutine,arg)=>{if(!_emscripten_has_threading_support()){return 6}var transferList=[];var error=0;if(ENVIRONMENT_IS_PTHREAD&&(transferList.length===0||error)){return pthreadCreateProxied(pthread_ptr,attr,startRoutine,arg)}if(error)return error;var threadParams={startRoutine,pthread_ptr,arg,transferList};if(ENVIRONMENT_IS_PTHREAD){threadParams.cmd="spawnThread";postMessage(threadParams,transferList);return 0}return spawnThread(threadParams)};var __emscripten_init_main_thread_js=tb=>{__emscripten_thread_init(tb,!ENVIRONMENT_IS_WORKER,1,!ENVIRONMENT_IS_WEB,65536,false);PThread.threadInitTLS()};var handleException=e=>{if(e instanceof ExitStatus||e=="unwind"){return EXITSTATUS}quit_(1,e)};var maybeExit=()=>{if(!keepRuntimeAlive()){try{if(ENVIRONMENT_IS_PTHREAD){if(_pthread_self())__emscripten_thread_exit(EXITSTATUS);return}_exit(EXITSTATUS)}catch(e){handleException(e)}}};var callUserCallback=func=>{if(ABORT){return}try{func();maybeExit()}catch(e){handleException(e)}};var waitAsyncPolyfilled=!Atomics.waitAsync||globalThis.navigator?.userAgent&&Number((navigator.userAgent.match(/Chrom(e|ium)\/([0-9]+)\./)||[])[2])<91;var __emscripten_thread_mailbox_await=pthread_ptr=>{if(!waitAsyncPolyfilled){var wait=Atomics.waitAsync(HEAP32,pthread_ptr>>2,pthread_ptr);wait.value.then(checkMailbox);var waitingAsync=pthread_ptr+128;Atomics.store(HEAP32,waitingAsync>>2,1)}};var checkMailbox=()=>callUserCallback(()=>{var pthread_ptr=_pthread_self();if(pthread_ptr){__emscripten_thread_mailbox_await(pthread_ptr);__emscripten_check_mailbox()}});var __emscripten_notify_mailbox_postmessage=(targetThread,currThreadId)=>{if(targetThread==currThreadId){setTimeout(checkMailbox)}else if(ENVIRONMENT_IS_PTHREAD){postMessage({targetThread,cmd:"checkMailbox"})}else{var worker=PThread.pthreads[targetThread];if(!worker){return}worker.postMessage({cmd:"checkMailbox"})}};var proxiedJSCallArgs=[];var __emscripten_receive_on_main_thread_js=(funcIndex,emAsmAddr,callingThread,bufSize,args)=>{proxiedJSCallArgs.length=0;var b=args>>3;var end=args+bufSize>>3;while(b<end){var arg;if(HEAP64[b++]){arg=HEAP64[b++]}else{arg=HEAPF64[b++]}proxiedJSCallArgs.push(arg)}var func=proxiedFunctionTable[funcIndex];PThread.currentProxiedOperationCallerThread=callingThread;var rtn=func(...proxiedJSCallArgs);PThread.currentProxiedOperationCallerThread=0;return rtn};var __emscripten_thread_cleanup=thread=>{if(!ENVIRONMENT_IS_PTHREAD)cleanupThread(thread);else postMessage({cmd:"cleanupThread",thread})};var __emscripten_thread_set_strongref=thread=>{if(ENVIRONMENT_IS_NODE){PThread.pthreads[thread].ref()}};var _emscripten_get_now=()=>performance.timeOrigin+performance.now();var _emscripten_date_now=()=>Date.now();var nowIsMonotonic=1;var checkWasiClock=clock_id=>clock_id>=0&&clock_id<=3;var INT53_MAX=9007199254740992;var INT53_MIN=-9007199254740992;var bigintToI53Checked=num=>num<INT53_MIN||num>INT53_MAX?NaN:Number(num);function _clock_time_get(clk_id,ignored_precision,ptime){ignored_precision=bigintToI53Checked(ignored_precision);if(!checkWasiClock(clk_id)){return 28}var now;if(clk_id===0){now=_emscripten_date_now()}else if(nowIsMonotonic){now=_emscripten_get_now()}else{return 52}var nsec=Math.round(now*1e3*1e3);HEAP64[ptime>>3]=BigInt(nsec);return 0}var _emscripten_check_blocking_allowed=()=>{};var runtimeKeepalivePush=()=>{runtimeKeepaliveCounter+=1};var _emscripten_exit_with_live_runtime=()=>{runtimeKeepalivePush();throw"unwind"};var _emscripten_num_logical_cores=()=>ENVIRONMENT_IS_NODE?require("os").cpus().length:navigator["hardwareConcurrency"];var abortOnCannotGrowMemory=requestedSize=>{abort("OOM")};var _emscripten_resize_heap=requestedSize=>{var oldSize=HEAPU8.length;requestedSize>>>=0;abortOnCannotGrowMemory(requestedSize)};function _fd_close(fd){if(ENVIRONMENT_IS_PTHREAD)return proxyToMainThread(3,0,1,fd);return 52}function _fd_seek(fd,offset,whence,newOffset){if(ENVIRONMENT_IS_PTHREAD)return proxyToMainThread(4,0,1,fd,offset,whence,newOffset);offset=bigintToI53Checked(offset);return 70}var printCharBuffers=[null,[],[]];var printChar=(stream,curr)=>{var buffer=printCharBuffers[stream];if(curr===0||curr===10){(stream===1?out:err)(UTF8ArrayToString(buffer));buffer.length=0}else{buffer.push(curr)}};function _fd_write(fd,iov,iovcnt,pnum){if(ENVIRONMENT_IS_PTHREAD)return proxyToMainThread(5,0,1,fd,iov,iovcnt,pnum);var num=0;for(var i=0;i<iovcnt;i++){var ptr=HEAPU32[iov>>2];var len=HEAPU32[iov+4>>2];iov+=8;for(var j=0;j<len;j++){printChar(fd,HEAPU8[ptr+j])}num+=len}HEAPU32[pnum>>2]=num;return 0}PThread.init();{initMemory();if(Module["noExitRuntime"])noExitRuntime=Module["noExitRuntime"];if(Module["print"])out=Module["print"];if(Module["printErr"])err=Module["printErr"];if(Module["wasmBinary"])wasmBinary=Module["wasmBinary"];if(Module["arguments"])arguments_=Module["arguments"];if(Module["thisProgram"])thisProgram=Module["thisProgram"];if(Module["preInit"]){if(typeof Module["preInit"]=="function")Module["preInit"]=[Module["preInit"]];while(Module["preInit"].length>0){Module["preInit"].shift()()}}}var proxiedFunctionTable=[_proc_exit,exitOnMainThread,pthreadCreateProxied,_fd_close,_fd_seek,_fd_write];var _malloc,_free,_futhark_context_config_set_num_threads,_futhark_context_get_error,_futhark_context_config_new,_futhark_context_config_free,_futhark_context_new,_futhark_context_free,_futhark_new_u8_1d,_futhark_free_u8_1d,_futhark_values_u8_1d,_futhark_values_raw_u8_1d,_futhark_shape_u8_1d,_futhark_new_f32_1d,_futhark_free_f32_1d,_futhark_values_f32_1d,_futhark_values_raw_f32_1d,_futhark_shape_f32_1d,_futhark_free_opaque_arr2d_rgba,_futhark_entry_debug_esdt,_futhark_entry_enhance_contrast_rgba,_futhark_entry_test_grayscale,_futhark_entry_test_pipeline_passthrough,__emscripten_tls_init,_pthread_self,__emscripten_thread_init,__emscripten_thread_crashed,__emscripten_run_js_on_main_thread,__emscripten_thread_free_data,__emscripten_thread_exit,__emscripten_check_mailbox,_emscripten_stack_set_limits,__emscripten_stack_restore,__emscripten_stack_alloc,_emscripten_stack_get_current,__indirect_function_table,wasmTable;function assignWasmExports(wasmExports){_malloc=Module["_malloc"]=wasmExports["v"];_free=Module["_free"]=wasmExports["w"];_futhark_context_config_set_num_threads=Module["_futhark_context_config_set_num_threads"]=wasmExports["x"];_futhark_context_get_error=Module["_futhark_context_get_error"]=wasmExports["z"];_futhark_context_config_new=Module["_futhark_context_config_new"]=wasmExports["A"];_futhark_context_config_free=Module["_futhark_context_config_free"]=wasmExports["B"];_futhark_context_new=Module["_futhark_context_new"]=wasmExports["C"];_futhark_context_free=Module["_futhark_context_free"]=wasmExports["D"];_futhark_new_u8_1d=Module["_futhark_new_u8_1d"]=wasmExports["E"];_futhark_free_u8_1d=Module["_futhark_free_u8_1d"]=wasmExports["F"];_futhark_values_u8_1d=Module["_futhark_values_u8_1d"]=wasmExports["G"];_futhark_values_raw_u8_1d=Module["_futhark_values_raw_u8_1d"]=wasmExports["H"];_futhark_shape_u8_1d=Module["_futhark_shape_u8_1d"]=wasmExports["I"];_futhark_new_f32_1d=Module["_futhark_new_f32_1d"]=wasmExports["J"];_futhark_free_f32_1d=Module["_futhark_free_f32_1d"]=wasmExports["K"];_futhark_values_f32_1d=Module["_futhark_values_f32_1d"]=wasmExports["L"];_futhark_values_raw_f32_1d=Module["_futhark_values_raw_f32_1d"]=wasmExports["M"];_futhark_shape_f32_1d=Module["_futhark_shape_f32_1d"]=wasmExports["N"];_futhark_free_opaque_arr2d_rgba=Module["_futhark_free_opaque_arr2d_rgba"]=wasmExports["O"];_futhark_entry_debug_esdt=Module["_futhark_entry_debug_esdt"]=wasmExports["P"];_futhark_entry_enhance_contrast_rgba=Module["_futhark_entry_enhance_contrast_rgba"]=wasmExports["Q"];_futhark_entry_test_grayscale=Module["_futhark_entry_test_grayscale"]=wasmExports["R"];_futhark_entry_test_pipeline_passthrough=Module["_futhark_entry_test_pipeline_passthrough"]=wasmExports["S"];__emscripten_tls_init=wasmExports["T"];_pthread_self=wasmExports["U"];__emscripten_thread_init=wasmExports["V"];__emscripten_thread_crashed=wasmExports["W"];__emscripten_run_js_on_main_thread=wasmExports["X"];__emscripten_thread_free_data=wasmExports["Y"];__emscripten_thread_exit=wasmExports["Z"];__emscripten_check_mailbox=wasmExports["_"];_emscripten_stack_set_limits=wasmExports["$"];__emscripten_stack_restore=wasmExports["aa"];__emscripten_stack_alloc=wasmExports["ba"];_emscripten_stack_get_current=wasmExports["ca"];__indirect_function_table=wasmTable=wasmExports["y"]}var wasmImports;function assignWasmImports(){wasmImports={b:___assert_fail,s:___pthread_create_js,i:__emscripten_init_main_thread_js,p:__emscripten_notify_mailbox_postmessage,t:__emscripten_receive_on_main_thread_js,f:__emscripten_thread_cleanup,h:__emscripten_thread_mailbox_await,k:__emscripten_thread_set_strongref,m:_clock_time_get,g:_emscripten_check_blocking_allowed,l:_emscripten_date_now,j:_emscripten_exit_with_live_runtime,c:_emscripten_get_now,n:_emscripten_num_logical_cores,o:_emscripten_resize_heap,d:_exit,r:_fd_close,q:_fd_seek,e:_fd_write,a:wasmMemory}}function run(){if(ENVIRONMENT_IS_PTHREAD){readyPromiseResolve?.(Module);initRuntime();return}preRun();function doRun(){Module["calledRun"]=true;if(ABORT)return;initRuntime();readyPromiseResolve?.(Module);Module["onRuntimeInitialized"]?.();postRun()}if(Module["setStatus"]){Module["setStatus"]("Running...");setTimeout(()=>{setTimeout(()=>Module["setStatus"](""),1);doRun()},1)}else{doRun()}}var wasmExports;if(!ENVIRONMENT_IS_PTHREAD){wasmExports=await (createWasm());run()}if(runtimeInitialized){moduleRtn=Module}else{moduleRtn=new Promise((resolve,reject)=>{readyPromiseResolve=resolve;readyPromiseReject=reject})}
;return moduleRtn}export default loadWASM;var isPthread=globalThis.self?.name?.startsWith("em-pthread");var isNode=globalThis.process?.versions?.node&&globalThis.process?.type!="renderer";if(isNode)isPthread=(await import("worker_threads")).workerData==="em-pthread";isPthread&&loadWASM();
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
    "debug_esdt" : ["debug_esdt", ["opaque_arr2d_rgba","f32"], ["[]f32"]],"enhance_contrast_rgba" : ["enhance_contrast_rgba", ["[]u8","i64","i64","f32","f32","f32"], ["[]u8"]],"test_grayscale" : ["test_grayscale", [], ["bool"]],"test_pipeline_passthrough" : ["test_pipeline_passthrough", [], ["bool"]]
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
new_u8_1d_from_jsarray(array1d) {
  return this.new_u8_1d(array1d, array1d.length);
}
new_u8_1d(array, d0) {
  console.assert(array.length === Number(d0), 'len=%s,dims=%s', array.length, [d0].toString());
    var copy = this.wasm._malloc(array.length << 0);
    this.wasm.HEAPU8.set(array, copy >> 0);
    var ptr = this.wasm._futhark_new_u8_1d(this.ctx, copy, BigInt(d0));
    this.wasm._free(copy);
    return this.new_u8_1d_from_ptr(ptr);
  }

  new_u8_1d_from_ptr(ptr) {
    return new FutharkArray(this, ptr, 'u8', 1, this.wasm.HEAPU8, this.wasm._futhark_shape_u8_1d, this.wasm._futhark_values_raw_u8_1d, this.wasm._futhark_free_u8_1d);
  }

debug_esdt(in0, in1) {
  var out = [4].map(n => this.wasm._malloc(n));
  var to_free = [];
  var do_free = () => { out.forEach(this.wasm._free); to_free.forEach(f => f.free()); };
  
  if (this.wasm._futhark_entry_debug_esdt(this.ctx, ...out, in0.ptr, in1) > 0) {
    do_free();
    throw this.get_error();
  }
    var result0 = this.new_f32_1d_from_ptr(this.wasm.HEAP32[out[0] >> 2]);
  do_free();
  return result0;
}
enhance_contrast_rgba(in0, in1, in2, in3, in4, in5) {
  var out = [4].map(n => this.wasm._malloc(n));
  var to_free = [];
  var do_free = () => { out.forEach(this.wasm._free); to_free.forEach(f => f.free()); };
    if (in0 instanceof Array) { in0 = this.new_u8_1d_from_jsarray(in0); to_free.push(in0); }
  if (this.wasm._futhark_entry_enhance_contrast_rgba(this.ctx, ...out, in0.ptr, in1, in2, in3, in4, in5) > 0) {
    do_free();
    throw this.get_error();
  }
    var result0 = this.new_u8_1d_from_ptr(this.wasm.HEAP32[out[0] >> 2]);
  do_free();
  return result0;
}
test_grayscale() {
  var out = [1].map(n => this.wasm._malloc(n));
  var to_free = [];
  var do_free = () => { out.forEach(this.wasm._free); to_free.forEach(f => f.free()); };
  
  if (this.wasm._futhark_entry_test_grayscale(this.ctx, ...out, ) > 0) {
    do_free();
    throw this.get_error();
  }
    var result0 = this.wasm.HEAP8[out[0] >> 0]!==0;
  do_free();
  return result0;
}
test_pipeline_passthrough() {
  var out = [1].map(n => this.wasm._malloc(n));
  var to_free = [];
  var do_free = () => { out.forEach(this.wasm._free); to_free.forEach(f => f.free()); };
  
  if (this.wasm._futhark_entry_test_pipeline_passthrough(this.ctx, ...out, ) > 0) {
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