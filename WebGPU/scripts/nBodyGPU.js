import { inicializarCells } from "./misFunciones.js";
import { renderShaderNBody } from "../shaders/shadersNBody.js";
import { computeShaderNBody } from "../shaders/shadersNBody.js";

// INITIAL VARIABLES
const [device, canvas, canvasFormat, context, timer] = await inicializarCells(); //TODO: ver en misFunciones
let N = 10000; // number of particles
let pdiam = 0.005; // size of particles
let rmin = 3.0;
let rmax = 6000;
let g = 2;
let colorshift = 0.0;
let fric = 0;
//const rngSeed = Math.random().toString();
//console.log(rngSeed);
//var rng = new alea(rngSeed);
const VELOCITY_FACTOR = 0.1;
let frame = 0; // simulation steps
let animationId, paused = true;
const WORKGROUP_SIZE = 64;
const canvasDims = new Float32Array ([canvas.width, canvas.height]);

let resettingSimulation = false;
let editingBuffers = false;
let stepping = false;
let uiSettings = {
	bgColor : [0, 0, 0, 1],
}

// TIMING & DEBUG -- véase https://omar-shehata.medium.com/how-to-use-webgpu-timestamp-query-9bf81fb5344a

let capacity, querySet, queryBuffer;
let t0, t1, t2;
if (timer) {
	capacity = 3; //Max number of timestamps we can store
	querySet = device.createQuerySet({
		type: "timestamp",
		count: capacity,
	});
	queryBuffer = device.createBuffer({
		size: 8 * capacity,
		usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
	});
}
async function readBuffer(device, buffer) {
	const size = buffer.size;
	const gpuReadBuffer = device.createBuffer({size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
	const copyEncoder = device.createCommandEncoder();
	copyEncoder.copyBufferToBuffer(buffer, 0, gpuReadBuffer, 0, size);
	const copyCommands = copyEncoder.finish();
	device.queue.submit([copyCommands]);
	await gpuReadBuffer.mapAsync(GPUMapMode.READ);
	return gpuReadBuffer.getMappedRange();
}


// Funciones varias
function getSeed(htmlElement){
	if (htmlElement.value == "") {
		const seed = Math.random().toFixed(7).toString();
		htmlElement.placeholder = seed;
		return seed;
	}
	return htmlElement.value;

}
function hexString_to_rgba(hexString, a){
	
	hexString = hexString.replace("#",""); // remove possible initial #

	const red = parseInt(hexString.substr(0, 2), 16) / 255	;    // Convert red component to 0-1 range
    const green = parseInt(hexString.substr(2, 2), 16) / 255;  // Convert green component to 0-1 range
    const blue = parseInt(hexString.substr(4, 2), 16) / 255;   // Convert blue component to 0-1 range

	// console.log(`Returned RGBA array [${[red, green, blue, a]}] from "#${hexString}" [hexString_to_rgba] `);

    return new Float32Array([red, green, blue, a]); // Store the RGB values in an array
}
function randomPosition(margin=0){
	return new Float32Array([
		(rng() - 0.5)*canvas.width,
		(rng() - 0.5)*canvas.height,
		0,
		1
	]);
}
function randomVelocity(){
	return new Float32Array([
		(rng() - 0.5)*VELOCITY_FACTOR,
		(rng() - 0.5)*VELOCITY_FACTOR
	]);
}
function validarNumberInput(input){
	// input es un objeto representando un html element input de type number
	const val = parseInt(input.value);
	const min = parseInt(input.min);
	const max = parseInt(input.max);

	if ( val < min || val > max || isNaN(val) ){
		console.log(`Entrada inválida: ${input.id}`);
		return false;
	}
	return true;

}
function validarNumberInput2(elem) {
	let val = parseFloat(elem.value);
	const min = parseFloat(elem.min);
	const max = parseFloat(elem.max);
	val = Math.max(min, val);
	val = Math.min(val, max);
	elem.value = val;
	return val;
}

// EVENT HANDLING

// panel de info
document.getElementById("canvasinfo").innerText = `${canvas.width} x ${canvas.height} (${canvas.width/canvas.height})`;
const displayTiming = document.getElementById("performanceinfo");
// ocultar interfaces
const panelTitle = document.getElementById("controlPanelTitle");
const cpOptions = document.getElementById("controlPanelOptions");
function hidePanel() {
	cpOptions.hidden ^= true;
	if (cpOptions.hidden){ panelTitle.style = "height: 3ch;"; } else { panelTitle.style = ""; }
}
panelTitle.onclick = hidePanel;
// seed input
const seedInput = document.getElementById("seed");
// canvas color
const bgColorPicker = document.getElementById("bgcolorpicker");
bgColorPicker.onchange = function() { uiSettings.bgColor = hexString_to_rgba(bgColorPicker.value, 1); }
// cantidad de partículas
const nPicker = document.getElementById("npicker");
nPicker.onchange = function() { 
	nPicker.value = Math.max(1, nPicker.value);
	nPicker.value = Math.min(nPicker.value, 100000);
	N = nPicker.value;
	resettingSimulation = true;
}
nPicker.oninput = function() { 
	let ancho = nPicker.value.length
	nPicker.style.width = `${ Math.max(ancho, 3) + 2 }ch`;
}
// tamaño de partículas
const dPicker = document.getElementById("diampicker");
dPicker.oninput = function() { 
	pdiam = dPicker.value*dPicker.value;
	editingBuffers = true;
}
// Color
const colPicker = document.getElementById("colorpicker");
colPicker.oninput = function() { 
	colorshift = colPicker.value;
	editingBuffers = true;
}
// rangos interacción
const rminPicker = document.getElementById("rminpicker");
const rmaxPicker = document.getElementById("rmaxpicker");
rminPicker.onchange = function() { 
	rmin = validarNumberInput2(rminPicker);
	editingBuffers = true;
}
rmaxPicker.onchange = function() { 
	rmax = validarNumberInput2(rmaxPicker);
	editingBuffers = true;
}
// "constante" G
const gPicker = document.getElementById("gpicker");
gPicker.onchange = function() { 
	g = validarNumberInput2(gPicker);
	editingBuffers = true;
}
// fricción
const fricPicker = document.getElementById("fricpicker");
fricPicker.onchange = function() { 
	fric = validarNumberInput2(fricPicker);
	editingBuffers = true;
}
// botón de reset
const resetButton = document.getElementById("resetbutton");
resetButton.onclick = function() { resettingSimulation = true;}
// botón de step_
const stepButton = document.getElementById("stepbutton");
const pauseButton = document.getElementById("pausebutton");
function stepear() {
	stepping = true;
	paused = true;
	animationId = requestAnimationFrame(newFrame);
	pauseButton.innerText = "Resumir";
	resetButton.hidden = false;
}
stepButton.onclick = stepear;
// pausa
function pausar() { 
	if (!paused) {
		pauseButton.innerText = "Resumir";
		cancelAnimationFrame(animationId);
	} else {
		pauseButton.innerText = "Pausa";
		animationId = requestAnimationFrame(newFrame);
	}
	paused ^= true;
	stepping = false;
	resetButton.hidden = false;
}
pauseButton.onclick = pausar;
// Controles
document.addEventListener('keydown', function(event) {
	switch (event.code){
		case "Space":
			event.preventDefault();
			pausar();
			break;
		case "KeyR":
			resettingSimulation = true; break;
		case "KeyS":
			stepear(); break;
		case "KeyW":
			hidePanel(); break;
	}
});
// botón de info debug
const infoButton = document.getElementById("mostrarinfo");
infoButton.onclick = function() { document.getElementById("infopanel").hidden ^= true; }


// VERTEX SETUP

const ar = canvas.width / canvas.height; // Canvas aspect ratio

const v = 1;
const vertices = new Float32Array([ // Coordenadas en clip space
	//   X,    Y,
	-v, -v, // Triangle 1 (Blue)
	v, -v,
	v,  v,

	-v, -v, // Triangle 2 (Red)
	v,  v,
	-v,  v,
]);
const vertexBuffer = device.createBuffer({
	label: "Particle vertices",
	size: vertices.byteLength, //12 * 32-bit floats (4 bits c/u) = 48 bytes
	usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(vertexBuffer, /*bufferOffset=*/ 0, vertices);

const vertexBuffersLayouts = [
	{
		arrayStride: 8, 					// cada vertex ocupa 8 bytes (2 *4-bytes)
		stepMode: "vertex",					// vertex es el default. "instance" dice que hay 1 por cada instancia
		attributes:[{ 						// array que es un atributo que almacena cada vertice (BLENDER!!!)
			format: "float32x2", 			// elijo el formato adecuado de la lista de GPUVertexFormat
			offset: 0, 						// a cuántos bytes del inicio del vertice empieza este atributo.
			shaderLocation: 0, 				// Position, see vertex shader. es un identificador exclusivo de este atributo. de 0 a 15.
		}]
	}, /* {
		arrayStride: 8,						// los 4 extremos de cada instancia ocupan en total 8 bytes (2 * 4bytes)
		stepMode: "instance",
		attributes:[{ 
			format: "float32x2",
			offset: 0,
			shaderLocation: 1,
		}]
	} */
];

let simulationPipeline;
let bindGroups;
let particleRenderPipeline;

// ARMAR BUFFERS Y PIPELINES

	const simParametersArrayBuffer = new ArrayBuffer(48);  // Crea un ArrayBuffer de 32 bytes
	const simParametersArray = new Float32Array(simParametersArrayBuffer);	// Crea un float32array que apunta o referencia al arraybuffer

	const uniformBuffer = device.createBuffer({
		label: "Parametros sim",
		size: simParametersArrayBuffer.byteLength,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	});


function editBuffers(){
	// Parámetros simulación

	//		Diccionario con los parámetros a ingresar
	const simParameters = {
		deltaTime: 1.0,
		rmin: rmin,
		rmax: rmax, // Math.max(...canvasDims)*4,
		g: g,
		lims: canvasDims,
		N: N,
		pdiam: pdiam, //diámetro de las partículas (en clip space, creo)
		colorshift: colorshift,
		fric: fric,
	}
	//		F32Array donde se cargan los datos de los parámetros para pasar al buffer 
	const simParametersArray2 = new Float32Array([
		simParameters.deltaTime,
		simParameters.rmin,
		simParameters.rmax,
		simParameters.g,
		simParameters.lims[0],
		simParameters.lims[1],
		simParameters.N,
		simParameters.pdiam,
		simParameters.colorshift,
		simParameters.fric,
	]);

	simParametersArray.set(simParametersArray2);
	device.queue.writeBuffer(uniformBuffer, 0, simParametersArrayBuffer);
}

let velocityBuffer;
function updateSimulationParameters(){
	console.log("Resetting simulation...");
	const rng = new alea(getSeed(seedInput)); // Resetear seed

	// SHADER SETUP

	const particleShaderModule = device.createShaderModule({
		label: "Particle shader",
		code: renderShaderNBody(),
	});

	const simulationShaderModule = device.createShaderModule({
		label: "Compute shader",
		code: computeShaderNBody(),
	})


	// CREACIÓN DE BUFFERS

	//aca iba lo de editbuffers
	editBuffers();

	// Posiciones de las partículas
	const positions = new Float32Array(N*4); // crea un array obj que apunta a la misma memoria que el ArrayBuffer devuelto por .get///
	for (let i = 0; i < N; i++) {
		positions[i * 4 + 0] = (rng() - 0.5)*2*canvas.width;
		positions[i * 4 + 1] = (rng() - 0.5)*2*canvas.height;
		positions[i * 4 + 2] = 0.0;
		positions[i * 4 + 3] = 1.0;
	}

	const positionBuffers = [
		device.createBuffer({
			label: "Positions buffer IN",
			size: positions.byteLength, //N * 4 * 4,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
		}),
		device.createBuffer({
			label: "Positions buffer OUT",
			size: positions.byteLength, //N * 4 * 4,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
		})
	];
	device.queue.writeBuffer(positionBuffers[0], 0, positions);

	// Velocidades de las particulas

	const velocities = new Float32Array(N*4);
	for (let i = 0; i < N; i++) {
		velocities[i * 4 + 0] = (rng() - 0.5)*VELOCITY_FACTOR;
		velocities[i * 4 + 1] = (rng() - 0.5)*VELOCITY_FACTOR;
		velocities[i * 4 + 2] = 0.0;
		velocities[i * 4 + 3] = 1.0;
	}
	velocityBuffer = device.createBuffer({
		label: "Velocities buffer",
		size: velocities.byteLength,
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,// | GPUBufferUsage.COPY_SRC,
	});
	device.queue.writeBuffer(velocityBuffer, 0, velocities);


	// BIND GROUP SETUP
	const bindGroupLayout = device.createBindGroupLayout({
		label: "Particle Bind Group Layout",
		entries: [{
			binding: 0,
			visibility: GPUShaderStage.COMPUTE | GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
			buffer: {}  // Uniform buffer, el default
		}, {
			binding: 1,
			visibility: GPUShaderStage.COMPUTE | GPUShaderStage.VERTEX,
			buffer: { type: "read-only-storage" } // Initial state input buffer
		}, {
			binding: 2,
			visibility: GPUShaderStage.COMPUTE,
			buffer: { type: "storage" }	// Final state output buffer (storage = read_write)
		}, {
			binding: 3, //velocidades
			visibility: GPUShaderStage.COMPUTE,
			buffer: { type: "storage" }
		}]
	});

	/* 	dictionary GPUBufferBinding {
		required GPUBuffer buffer;
		GPUSize64 offset = 0; // en bytes (default 0)
		GPUSize64 size; // en bytes (default: desde offset hasta el final de buffer)
	}; */

	bindGroups = [
		device.createBindGroup({
			label: "Particle renderer bind group A",
			layout: bindGroupLayout,
			entries: [{
				binding: 0,
				resource: { buffer: uniformBuffer } // Parámetros de la simulación
			}, {
				binding: 1,
				resource: { buffer: positionBuffers[0] }
			}, {
				binding: 2,
				resource: { buffer: positionBuffers[1] }
			},{
				binding: 3,
				resource: { buffer: velocityBuffer }
			}],
		}),
		device.createBindGroup({
			label: "Particle renderer bind group B",
			layout: bindGroupLayout,
			entries: [{
				binding: 0,
				resource: { buffer: uniformBuffer }
			}, {
				binding: 1,
				resource: { buffer: positionBuffers[1] }
			}, {
				binding: 2,
				resource: { buffer: positionBuffers[0] }
			}, {
				binding: 3,
				resource: { buffer: velocityBuffer }
			}],
		})
	];

	// PIPELINE SETUP

	const pipelineLayout = device.createPipelineLayout({
		label: "Particle Pipeline Layout",
		bindGroupLayouts: [ bindGroupLayout ],
	}); // El orden de los bind group layours tiene que coincidir con los atributos @group en el shader

	// Crear una render pipeline (para usar vertex y fragment shaders)
	particleRenderPipeline = device.createRenderPipeline({
		label: "Particle render pipeline",
		layout: pipelineLayout,
		vertex: {
			module: particleShaderModule,
			entryPoint: "vertexMain",
			buffers: vertexBuffersLayouts,
		},
		fragment: {
			module: particleShaderModule,
			entryPoint: "fragmentMain",
			targets: [{ // targets es un array de diccionarios GPUColorTargetState
				format: canvasFormat, // es un elemento requerido de GPUColorTargetState
/* 				blend: {				// GPUBlendState, es un diccionaro que requiere color y alpha
					color: {			// GPUBlendComponent color
						srcFactor: "src-alpha",	//GPUBlendFactor (es un enum, parece una lista de strings). default to "one"
						dstFactor: "one",		//GPUBlendFactor (es un enum, parece una lista de strings). default to "zero"
						operation: "add",		//GPUBlendOperation (es otro enum). default to "add"
					},
					alpha: {			// GPUBlendComponent alpha
						srcFactor: "zero",
						dstFactor: "one",
						operation: "add",
					},
				}, */
			}]
		}
	});

	// COMPUTE PIPELINE 
	simulationPipeline = device.createComputePipeline({
		label: "Simulation pipeline",
		layout: pipelineLayout,
		compute: {
			module: simulationShaderModule,
			entryPoint: "computeMain",
			constants: { // es una entrada opcional, acá puedo poner valores que usará el compute shader
				//constante: 1, // Así paso el workgroup size al compute shader
			},
		},
	});
}

const renderPassDescriptor = {	//Parámetros para el render pass que se ejecutará cada frame
	colorAttachments: [{		// es un array, de momento sólo hay uno, su @location en el fragment shader es entonces 0
		view: context.getCurrentTexture().createView(),
		loadOp: "clear",
		clearValue: uiSettings.bgColor,
		storeOp: "store",
	}]
};


// Lo que sigue es rendering (y ahora compute) code, lo pongo adentro de una función para loopearlo
updateSimulationParameters() // Generate initial parameters

async function newFrame(){

	if ( resettingSimulation ) {	// Rearmar buffers y pipeline
		frame = 0;
		updateSimulationParameters();
		resettingSimulation = false;
	}

	if ( editingBuffers ) {
		editBuffers();
		editingBuffers = false;
	}

	const encoder = device.createCommandEncoder();

	if (timer) {	 // Initial timestamp - before compute pass
		encoder.writeTimestamp(querySet, 0);
	} else {
		t0 = window.performance.now();
	}
	const computePass = encoder.beginComputePass();
	

	computePass.setPipeline(simulationPipeline);
	computePass.setBindGroup(0, bindGroups[frame % 2]);

	/* El compute shader se ejecutará N veces. El workgroup size es 64, entonces despacho ceil(N/64) workgroups, todos en el eje x. */

	const workgroupCount = Math.ceil(N / WORKGROUP_SIZE);
	computePass.dispatchWorkgroups(workgroupCount, 1, 1); // Este vec3<u32> tiene su propio @builtin en el compute shader.

	computePass.end();

	if (timer) {	 // Timestamp - after compute pass
		encoder.writeTimestamp(querySet, 1);
	} else {
		t1 = window.performance.now();
	}
	
	frame++;
	
	// Iniciar un render pass (que usará los resultados del compute pass)
	
	renderPassDescriptor.colorAttachments[0].clearValue = uiSettings.bgColor; // Actualizar color de fondo.
	renderPassDescriptor.colorAttachments[0].view = context.getCurrentTexture().createView();
	const pass = encoder.beginRenderPass(renderPassDescriptor);

	pass.setPipeline(particleRenderPipeline);
	pass.setVertexBuffer(0, vertexBuffer); // este buffer corresponde al 0-ésimo elemento en vertex.buffers de la pipeline
	pass.setBindGroup(0, bindGroups[frame % 2]);		// este 0 corresponde al @group(0). Indica que los bindgroups estos irán a ese group
	
	pass.draw(vertices.length /2, N);	// 6 vertices. renderizados N veces


	pass.end(); // finaliza el render pass

	if (timer) {	 // Timestamp - after render pass
		encoder.writeTimestamp(querySet, 2);
		encoder.resolveQuerySet(
			querySet, 
			0, // index of first query to resolve 
			capacity, //number of queries to resolve
			queryBuffer, 
			0); // destination offset
	} else {
		t2 = window.performance.now();
	}

	device.queue.submit([encoder.finish()]);
	t2 = window.performance.now();

	//if ((frame + 30) % 60 == 0) {
		//const values = new Float32Array( await readBuffer(device, velocityBuffer ));
		//console.log(values)
	//}

	if (frame % 60 == 0) {	// Leer el storage buffer y mostrarlo en debug info (debe estar después de encoder.finish())

		let dif1, dif2, text = "";
		if (timer) {
			const arrayBuffer = await readBuffer(device, queryBuffer);
			const timingsNanoseconds = new BigInt64Array(arrayBuffer);
			dif1 = Number(timingsNanoseconds[1]-timingsNanoseconds[0])/1_000_000;
			dif2 = Number(timingsNanoseconds[2]-timingsNanoseconds[1])/1_000_000;
		} else {
			dif1 = (t1 - t0).toFixed(4);
			dif2 = (t2 - t1).toFixed(4);
			text +="⚠ GPU Timing desact.\n"
		}
		text += `Compute: ${dif1} ms\nDraw: ${dif2} ms`
		if (dif1+dif2 > 30) {
			text = text + "\nGPU: Brrrrrrrrrrr";
		}
		displayTiming.innerText = text;

	}

	if ( !stepping ){	// Iniciar nuevo frame
		animationId = requestAnimationFrame(newFrame);
	}
}


if (!paused){
	animationId = requestAnimationFrame(newFrame);
}


//TODO:
/* exportar e importar json con partículas y reglas */
// ref https://www.cg.tuwien.ac.at/research/publications/2023/PETER-2023-PSW/PETER-2023-PSW-.pdf