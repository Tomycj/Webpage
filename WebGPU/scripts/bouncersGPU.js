import { inicializarCells } from "inicializar-webgpu";
import { renderShader, computeShader } from "shaders bouncers";

// OBJETOS HTML
	const
	controlPanel = document.getElementById("controlpanel"),
	tOutput = document.getElementById("testoutput"),

	bgColorPicker = document.getElementById("bgcolorpicker"),
	nPicker = document.getElementById("npicker"),

	pauseButton = document.getElementById("pausebutton"),
	resetButton = document.getElementById("resetbutton"),
	stepButton = document.getElementById("stepbutton"),

	aColorPicker = document.getElementById("acolorpicker"),
	bColorPicker = document.getElementById("bcolorpicker"),
	checkRadial = document.getElementById("radial"),
	checkOrigin = document.getElementById("origin"),
	checkAutoRestart = document.getElementById("autorestart");

//

// INITIAL VARIABLES

const [device, canvas, canvasFormat, context] = await inicializarCells();
canvas.width += 8; // When no scrollbar

const
WORKGROUP_SIZE = 256,
canvasDims = new Float32Array ([canvas.width, canvas.height]),
VELOCITY_FACTOR = 7;

let
paused = true,
N = nPicker.value, // Cantidad de partículas. Por algún motivo funciona OK aunque sea un string
step = 0, // simulation steps
animationId,
updatingParameters = true,
stepping = false,
uiSettings = {
	bgColor : hexString_to_rgba(bgColorPicker.value, 1),
},
margin = 0.25,
colorA = hexString_to_rgba(aColorPicker.value, 1),
colorB = hexString_to_rgba(bColorPicker.value, 1);

function hexString_to_rgba(hexString, a){
	
	hexString = hexString.replace("#",""); // remove possible initial #

	const red = parseInt(hexString.substr(0, 2), 16) / 255	;    // Convert red component to 0-1 range
    const green = parseInt(hexString.substr(2, 2), 16) / 255;  // Convert green component to 0-1 range
    const blue = parseInt(hexString.substr(4, 2), 16) / 255;   // Convert blue component to 0-1 range

	//console.log(`Returned RGBA array [${[red, green, blue, a]}] from "#${hexString}" [hexString_to_rgba] `);

    return new Float32Array([red, green, blue, a]); // Store the RGB values in an array
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
function fillRandomPositions(array, N, circular, margin) {
	if (circular.checked) {
		const R = Math.min(canvas.width*(1-margin), canvas.height*(1-margin));
		for	(let i = 0; i < N*4; i +=4 ) {
			const r = R * Math.sqrt(Math.random());
			const tita = Math.random() * 2 * Math.PI;
			array.set([
				r * Math.cos(tita),
				r * Math.sin(tita),
				0,
				1
			], i);
		}
	} else {
		for	(let i = 0; i < N*4; i +=4 ) {
			array.set([
				(Math.random() - 0.5) * canvas.width,
				(Math.random() - 0.5) * canvas.height,
				0,
				1
			], i);
		}
	}
}
function fillRandomVelocities (array, N, circular, R) {
	if (circular) {

		for	(let i = 0; i < N*2; i += 2 ) {
			const r = R * Math.sqrt(Math.random());
			const tita = Math.random() * 2 * Math.PI;
			array.set([
				r * Math.cos(tita),
				r * Math.sin(tita),
			], i);
		}
	} else {
		for	(let i = 0; i < N*2; i += 2 ) {
			array.set([
				(Math.random() - 0.5) * R,
				(Math.random() - 0.5) * R
			], i);
		}
	}
}

// EVENT HANDLING

	// test output
	tOutput.innerText = `${canvas.width} x ${canvas.height}. ar = ${canvas.width/canvas.height}`;
	tOutput.hidden = true;

	// canvas color
	bgColorPicker.onchange = _=> { uiSettings.bgColor = hexString_to_rgba(bgColorPicker.value, 1); }

	// elegir cantidad de partículas
	nPicker.onchange = _=> { 
		nPicker.value = Math.max(1, nPicker.value);
		nPicker.value = Math.min(nPicker.value, nPicker.max);
		N = nPicker.value;
		updatingParameters = true;
	}
	nPicker.oninput = _=> { 
		let ancho = nPicker.value.length
		nPicker.style.width = `${ Math.min (Math.max(ancho, 3) + 2, 9) }ch`;
	}

	// botón de pausa
	pauseButton.onclick = _=> { 
		
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
	resetButton.onclick = _=> { updatingParameters = true;}

	// botón de step
	stepButton.onclick = _=> { 
		stepping = true;
		paused = true;
		animationId = requestAnimationFrame(newFrame);
		pauseButton.innerText = "Resumir";
		resetButton.hidden = false;
	}

	// Controles
	document.addEventListener("keydown", function(event) {
		
		const isTextInput = event.target.tagName === "INPUT" && event.target.type === "text";
		
		if (isTextInput || event.ctrlKey) { return; }

		if (event.target.type === "range") { event.target.blur(); }

		switch (event.code){
			case "Space":
				event.preventDefault();
				pauseButton.click();
				break;
			case "KeyR":
				resetButton.click();
				break;
			case "KeyS":
				stepButton.click();
				break;
			case "KeyW":
			case "KeyH":
				controlPanel.hidden ^= true;
				break;
		}
	});

	// particle color
	aColorPicker.onchange = _=> {
		colorA = hexString_to_rgba(aColorPicker.value, 1);
		if (checkAutoRestart.checked) { updatingParameters = true; }
	}
	bColorPicker.onchange = _=> {
		colorB = hexString_to_rgba(bColorPicker.value, 1);
		if (checkAutoRestart.checked) { updatingParameters = true; }
	}

	// Patrón checkRadial.checked
	checkRadial.onchange = _=> { 
		if (checkAutoRestart.checked) { updatingParameters = true; }
	}
	checkOrigin.onchange = _=> { 
		if (checkAutoRestart.checked) { updatingParameters = true; }
	}

//

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
//

let simulationPipeline;
let bindGroups;
let particleRenderPipeline;

// ARMAR BUFFERS Y PIPELINES
function updateSimulationParameters(){
	
	// SHADER SETUP

	const particleShaderModule = device.createShaderModule({
		label: "Particle shader",
		code: renderShader(N, colorA, colorB ),
	});

	const simulationShaderModule = device.createShaderModule({
		label: "Compute shader",
		code: computeShader(WORKGROUP_SIZE, N),
	})

	// CREACIÓN DE BUFFERS

	// Dimensiones del canvas
	const uniformBuffer = device.createBuffer({
		label: "Particles Uniforms",
		size: canvasDims.byteLength,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	});
	device.queue.writeBuffer(uniformBuffer, 0, canvasDims);

	// Posiciones

	const positions = new Float32Array(N*4);

	if (!checkOrigin.checked) { fillRandomPositions(positions, N, checkRadial.checked, margin); }

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

	// Velocidades

	const velocities = new Float32Array(N*2);
	fillRandomVelocities(velocities, N, checkRadial.checked, VELOCITY_FACTOR);

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
if (!paused){
	animationId = requestAnimationFrame(newFrame);
}

//TODO: permitir cambiar algunos parámetros (como el color de las partículas) sin tener que reiniciar la simulación entera (las posiciones y velocidades)
