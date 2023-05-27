import { inicializarCells } from "./misFunciones.js";
import { renderShader } from "../shaders/cells3D.js";
import { computeShader } from "../shaders/cells3D.js";

// INITIAL VARIABLES
const [device, canvas, canvasFormat, context] = await inicializarCells();
let N = 10000; // number of particles
const VELOCITY_FACTOR = 0.1;
const UPDATE_INTERVAL = 1000/60; // ms
let step = 0; // simulation steps
let animationId, paused = true;
const WORKGROUP_SIZE = 64;
const canvasDims = new Float32Array ([canvas.width, canvas.height]);
let elementaries = []; // array donde cada elemento es un array de las partículas de un tipo determinado
let colores = []; // cada elemento es un color, el de cada tipo de part.
let radios = [];  // cada elemento es un radio, el de cada tipo de part.
let nombres = []; // cada elemento es el nombre de cada tipo de part.
let rules = [];   // cada elemento es una regla, formada por un array de 6 números (parámetros de la regla)

let updatingParameters = true;
let stepping = false;
let uiSettings = {
	bgColor : [0, 0, 0, 1],
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
		(Math.random() - 0.5)*canvas.width,
		(Math.random() - 0.5)*canvas.height,
		0,
		1
	]);
}
function randomVelocity(){
	return new Float32Array([
		(Math.random() - 0.5)*VELOCITY_FACTOR,
		(Math.random() - 0.5)*VELOCITY_FACTOR
	]);
}
function crearElementary(submission){
	// crea un array de n partículas. Submission es un diccionario como particleCreatorSubmission
	const n = submission.cantidad;
	const particulas = new Array(n);
	for (let i=0 ; i < n ; i++ ){
		particulas[i] = [randomPosition(), randomVelocity()] // randomPosition es vec4f y randomVel es vec2f
	}
	return particulas;
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

// EVENT HANDLING

// test output
const tOutput = document.getElementById("testoutput");
tOutput.innerText = `${canvas.width} x ${canvas.height}. ar = ${canvas.width/canvas.height}`;
// canvas color
const bgColorPicker = document.getElementById("bgcolorpicker");
bgColorPicker.onchange = function() { uiSettings.bgColor = hexString_to_rgba(bgColorPicker.value, 1); }
// elegir cantidad de partículas (legacy)
const nPicker = document.getElementById("npicker");
nPicker.onchange = function() { 
	nPicker.value = Math.max(0, nPicker.value);
	nPicker.value = Math.min(nPicker.value, 100000);
	N = nPicker.value;
}
nPicker.oninput = function() { 
	let ancho = nPicker.value.length
	nPicker.style.width = `${ Math.max(ancho, 3) + 2 }ch`;
}
// botón de pausa
const pauseButton = document.getElementById("pausebutton");
pauseButton.onclick = function() { 
	
	if (!paused) {
		pauseButton.innerText = "Resumir";
		cancelAnimationFrame(animationId);
	} else {
		paused = true;
		pauseButton.innerText = "Pausa";
		animationId = requestAnimationFrame(newFrame);
	}
	paused = !paused;
	stepping = false;
	resetButton.hidden = false;

}
// botón de reset
const resetButton = document.getElementById("resetbutton");
resetButton.onclick = function() { updatingParameters = true;}
// botón de step
const stepButton = document.getElementById("stepbutton");
stepButton.onclick = function() { 
	stepping = true;
	paused = true;
	animationId = requestAnimationFrame(newFrame);
	pauseButton.innerText = "Resumir";
	resetButton.hidden = false;
}
// Creador de partículas
const submitElementaryButton = document.getElementById("c.elemsubmit");
const afectaSelector = document.getElementById("targetselect");
const ejercidaSelector = document.getElementById("sourceselect");
const particleSelector = document.getElementById("particleselect");
submitElementaryButton.onclick = function(){

	// Elementos html
	const c_nom = document.getElementById("c.nom");  
	const c_col = document.getElementById("c.col");   
	const c_cant = document.getElementById("c.cant"); 
	const c_radius = document.getElementById("c.radius"); 
	
	// Validacióm
	if ( !validarNumberInput(c_cant) || !validarNumberInput(c_radius) || ( c_nom.value == "" ) ) {
		return;
	}

	// Una vez validado todo:
	const particleCreatorSubmission = {
		nombre: c_nom.value,					// string
		color: hexString_to_rgba(c_col.value),  // vec4f    (orig. string like "#000000")
		cantidad: parseInt(c_cant.value),		// integer (originalmente string)
		radio: parseFloat(c_radius.value),		// float   (originalmente string)
	}

	if ( nombres.includes(particleCreatorSubmission.nombre) ){
		console.log("Reemplazando partículas del mismo nombre...")

		let i = nombres.indexOf(particleCreatorSubmission.nombre);

		elementaries[i] = ( crearElementary(particleCreatorSubmission) ); //agregar array con posiciones y velocidades
		nombres[i] = (particleCreatorSubmission.nombre);
		colores[i] = (particleCreatorSubmission.color);
		radios[i] = (particleCreatorSubmission.radio);

	} else {
		elementaries.push( crearElementary(particleCreatorSubmission) ); //agregar array con posiciones y velocidades
		nombres.push(particleCreatorSubmission.nombre);
		colores.push(particleCreatorSubmission.color);
		radios.push(particleCreatorSubmission.radio);

		// actualizar lista de nombres en el creador de reglas de interacción
		const option = document.createElement("option");
		option.value = particleCreatorSubmission.nombre;
		option.text = particleCreatorSubmission.nombre;
		afectaSelector.appendChild(option);

		const option2 = option.cloneNode(true);
		ejercidaSelector.appendChild(option2);

		const option3 = option.cloneNode(true);
		particleSelector.appendChild(option3);

	}

	//console.log("Elementaries (todas las partículas):");
	//console.log(elementaries);

}

// Creador de reglas de interacción
const submitRuleButton = document.getElementById("r.submit");
const ruleSelector = document.getElementById("ruleselect");
submitRuleButton.onclick = function(){

	const r_intens = document.getElementById("r.intens");  
	const r_qm = document.getElementById("r.qm");
	const r_dmin = document.getElementById("r.dmin");  
	const r_dmax = document.getElementById("r.dmax");    

	// validación
	if ( !validarNumberInput(r_intens) || !validarNumberInput(r_qm) || !validarNumberInput(r_dmin) || !validarNumberInput(r_dmax) ){
		return;
	}

	const targetIndex = afectaSelector.selectedIndex;
	const sourceIndex = ejercidaSelector.selectedIndex;
	const newRule = [
		targetIndex,
		sourceIndex,
		parseFloat(r_intens.value),
		parseFloat(r_qm.value),
		parseFloat(r_dmin.value),
		parseFloat(r_dmax.value),
	];

	rules.push(newRule)
	const option = document.createElement("option");
	option.text = `${afectaSelector.options[targetIndex].value} ← ${ejercidaSelector.options[sourceIndex].value}`;
	ruleSelector.appendChild(option);

}

// Rule manager
const borraRuleButton = document.getElementById("borrarule");
borraRuleButton.onclick = function(){
	const indexToDelete = ruleSelector.selectedIndex;
	rules.splice(indexToDelete,1);
	ruleSelector.options[indexToDelete].remove();
}

// Particle manager
const borraParticleButton = document.getElementById("borraparticula");
borraParticleButton.onclick = function(){
	const indexToDelete = particleSelector.selectedIndex;
	elementaries.splice(indexToDelete,1);
	particleSelector.options[indexToDelete].remove();
	afectaSelector.options[indexToDelete].remove();
	ejercidaSelector.options[indexToDelete].remove();
	console.log(elementaries);
	//TODO: Ver qué hacer con las reglas de elementaries borrados
}


// VERTEX SETUP

const ar = canvas.width / canvas.height; // Canvas aspect ratio

const vertices = new Float32Array([
	//   X,    Y,
	-1, -1, // Triangle 1 (Blue)
	1, -1,
	1,  1,

	-1, -1, // Triangle 2 (Red)
	1,  1,
	-1,  1,
]);
const vertexBuffer = device.createBuffer({
	label: "Particle vertices",
	size: vertices.byteLength, //12 * 32-bit floats (4 bits c/u) = 48 bytes
	usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(vertexBuffer, /*bufferOffset=*/ 0, vertices);

const vertexBufferLayout = {
	arrayStride: 8, 					// cada vertex ocupa 8 bytes (2 *4-bytes)
	attributes:[{ 						// array que es un atributo que almacena cada vertice (BLENDER!!!)
		format: "float32x2", 			// elijo el formato adecuado de la lista de GPUVertexFormat
		offset: 0, 						// a cuántos bytes del inicio del vertice empieza este atributo.
		shaderLocation: 5, 				// Position, see vertex shader. es un identificador exclusivo de este atributo. de 0 a 15.
	}]
};


let simulationPipeline;
let bindGroups;
let particleRenderPipeline;

// ARMAR BUFFERS Y PIPELINES
function updateSimulationParameters(){
	// SHADER SETUP

	const particleShaderModule = device.createShaderModule({
		label: "Particle shader",
		code: renderShader(),
	});

	const simulationShaderModule = device.createShaderModule({
		label: "Compute shader",
		code: computeShader(WORKGROUP_SIZE, N),
	})


	// CREACIÓN DE BUFFERS

	// dimensiones del canvas
	const uniformBuffer = device.createBuffer({
		label: "Particles Uniforms",
		size: canvasDims.byteLength,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	});
	device.queue.writeBuffer(uniformBuffer, 0, canvasDims);

	// posiciones de las partículas
	const positions = new Float32Array(N*4); // crea un array obj que apunta a la misma memoria que el ArrayBuffer devuelto por .get///
	for (let i = 0; i < N; i++) {
		positions[i * 4 + 0] = (Math.random() - 0.5)*canvas.width;
		positions[i * 4 + 1] = (Math.random() - 0.5)*canvas.height;
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

	// velocidades de las particulas

	const velocities = new Float32Array(N*2);
	for (let i = 0; i < N; i++) {
		velocities[i * 2 + 0] = (Math.random() - 0.5)*VELOCITY_FACTOR;
		velocities[i * 2 + 1] = (Math.random() - 0.5)*VELOCITY_FACTOR;
	}
	const velocityBuffer = device.createBuffer({
		label: "Velocities buffer",
		size: velocities.byteLength,
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
	});
	device.queue.writeBuffer(velocityBuffer, 0, velocities);


	// BIND GROUP SETUP
	const bindGroupLayout = device.createBindGroupLayout({
		label: "Particle Bind Group Layout",
		entries: [{
			binding: 0,
			visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
			buffer: {}  // Grid uniform buffer, el default
		}, {
			binding: 1,
			visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
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

	bindGroups = [
		device.createBindGroup({
			label: "Particle renderer bind group A",
			layout: bindGroupLayout,
			entries: [{
				binding: 0,
				resource: { buffer: uniformBuffer }
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
	}); // El orden de los bind group layours tiene que coincider con los atributos @group en el shader

	// Crear una render pipeline (para usar vertex y fragment shaders)
	particleRenderPipeline = device.createRenderPipeline({
		label: "Particle render pipeline",
		layout: pipelineLayout,
		vertex: {
			module: particleShaderModule,
			entryPoint: "vertexMain",
			buffers: [vertexBufferLayout]
		},
		fragment: {
			module: particleShaderModule,
			entryPoint: "fragmentMain",
			targets: [{
				format: canvasFormat
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
		}
	});
}


// Lo que sigue es rendering (y ahora compute) code, lo pongo adentro de una función para loopearlo

function newFrame(){

	if ( updatingParameters ){
		// Rearmar buffers y pipeline
		console.log("Updating...");
		step = 0;
		updateSimulationParameters();
		console.log("updated!");
		updatingParameters = false;
	}

	const encoder = device.createCommandEncoder();
	const computePass = encoder.beginComputePass();

	computePass.setPipeline(simulationPipeline);
	computePass.setBindGroup(0, bindGroups[step % 2]);

	/* El compute shader se ejecutará N veces. El workgroup size es 8, entonces despacho ceil(N/8) workgroups, todos en el eje x. */

	const workgroupCount = Math.ceil(N / WORKGROUP_SIZE);
	computePass.dispatchWorkgroups(workgroupCount, 1, 1);

	computePass.end();
	console.log("a");


	step++;
	
	// Iniciar un render pass (que usará los resultados del compute pass)
	
	const pass = encoder.beginRenderPass({
		colorAttachments: [{
			view: context.getCurrentTexture().createView(),
			loadOp: "clear",
			clearValue: uiSettings.bgColor,
			storeOp: "store",
		}]
	});

	pass.setPipeline(particleRenderPipeline);
	pass.setVertexBuffer(0, vertexBuffer);
	pass.setBindGroup(0, bindGroups[step % 2]);		
	
	pass.draw(vertices.length /2, N);	// 6 vertices. renderizados n^2 veces


	pass.end(); // finaliza el render pass

	device.queue.submit([encoder.finish()]);

	if ( !stepping ){
		animationId = requestAnimationFrame(newFrame);
	}



}

// Preparar updateGrid para ejecutarse repetidamente

if (!paused){
	animationId = requestAnimationFrame(newFrame);
}
//setInterval(updateGrid, UPDATE_INTERVAL);
