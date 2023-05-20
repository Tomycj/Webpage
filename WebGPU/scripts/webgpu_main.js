
const estatus = document.getElementById("estatus");

//Revisar si existe el objeto que sirve como punto de partida para acceder a la GPU. Es para revisar si el dispositivo es compatible con WebGPU
if (!navigator.gpu) {
	estatus.innerText = "Error: Este navegador parece no ser  <a href='https://caniuse.com/webgpu' style='color: green'>compatible con WebGPU</a>, verifique que esté actualizado";
	throw new Error("WebGPU not supported on this browser.");
}

//Solicitar un GPUAdapter, que es cómo se representa una pieza del GPU. Devuelve un objeto tipo promesa, por eso se lo llama con await
const adapter = await navigator.gpu.requestAdapter(); //puede recibir argumentos extra sobre qué clase de GPU prefiere usar (performance vs power etc)
if (!adapter){
	estatus.innerText = "Error: No se detectó GPU. Asegúrese de usar un dispositivo con GPU (placa de video / acelerador de gráficos)";
	throw new Error("No se encontró GPUAdapter.");
} // si no hay adapter, puede devolver null

const canvas = document.querySelector("canvas"); canvas.hidden = false; 
estatus.innerText = "La GPU de tu equipo está calculando y renderizando esto!"

const GRID_SIZE = 32;
const UPDATE_INTERVAL = 60; // ms
let step = 0; // simulation steps
const WORKGROUP_SIZE = 8;

import { squaresGrid_Struts } from "../shaders/squaresgrid_struts.js";
import { gol} from "../shaders/squaresgrid_struts.js";

//Ahora consigo un GPUDevice, la interfaz a traves de la cual por lo general se interactúa con la GPU
const device = await adapter.requestDevice();

//Ahora vamos a configurar el canvas para que use el device
const context = canvas.getContext("webgpu");
const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
context.configure({
	device: device,
	format: canvasFormat, //es el texture format que el context debería usar
});

// Creo un typedarray con vértices. Para no repetir vértices, se puede pasar la info sobre cómo onstruir los triángulos usando Index Buffers
/* Creo un buffer en el device mediante un objeto, el buffer es un bloque de memoria al que accede la GPU.
Especifico que el buffer se usará para vertex data, y que quiero poder copiar data into él.
El objeto vertexBuffer es opaco, no se puede ver su data. Además, la mayoría de sus atributos no se pueden
cambiar (inmutables). Lo que sí se puede cambiar es el contenido de su memoria, que empieza vacía. */
const vertices = new Float32Array([
	//   X,    Y,
	-0.8, -0.8, // Triangle 1 (Blue)
	0.8, -0.8,
	0.8,  0.8,

	-0.8, -0.8, // Triangle 2 (Red)
	0.8,  0.8,
	-0.8,  0.8,
]);
const vertexBuffer = device.createBuffer({
	label: "Cell vertices",
	size: vertices.byteLength, //12 * 32-bit floats (4 bits c/u) = 48 bytes
	usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(vertexBuffer, /*bufferOffset=*/ 0, vertices);

// Creo un uniform buffer que describe la grilla 
const uniformArray = new Float32Array ([GRID_SIZE, GRID_SIZE]);
const uniformBuffer = device.createBuffer({
	label: "Grid Uniforms",
	size: uniformArray.byteLength,
	usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(uniformBuffer, 0, uniformArray);

// Creo 2 storage buffers que representan el estado de cada celda, y lo lleno con un valor antes de writebuffer
const cellStateArray = new Uint32Array(GRID_SIZE*GRID_SIZE);
const cellStateStorage = [
	device.createBuffer({
		label: "Cell State A",
		size: cellStateArray.byteLength,
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
	}),
	device.createBuffer({
		label: "Cell State B",
		size: cellStateArray.byteLength,
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
	})
];


for (let i = 0; i < cellStateArray.length; ++i) {
	cellStateArray[i] = Math.random() > 0.6 ? 1 : 0;
}
device.queue.writeBuffer(cellStateStorage[0], 0, cellStateArray);




// defino la estructura de la informacion de los vertices con el diccionario:
const vertexBufferLayout = {
	arrayStride: 8, 					// cada vertex ocupa 8 bytes (2 *4-bytes)
	attributes:[{ 						// array que es un atributo que almacena cada vertice (BLENDER!!!)
		format: "float32x2", 			// elijo el formato adecuado de la lista de GPUVertexFormat
		offset: 0, 						// a cuántos bytes del inicio del vertice empieza este atributo.
		shaderLocation: 0, 				// Position, see vertex shader. es un identificador exclusivo de este atributo. de 0 a 15.
	}]
};

// Ahora vienen los shaders. Escritos en lenguaje WGSL. Se pasan como strings.
const cellShaderModule = device.createShaderModule({
	label: "Cell shader",
	code: squaresGrid_Struts(0),
}); // se pueden poner en shadermodules distintos, para usar varios fragment shader con el mismo vert.shader

const simulationShaderModule = device.createShaderModule({
	label: "GoL shader",
	code: gol(WORKGROUP_SIZE),
})

// Crear un bind group layout y un pipeline layout
const bindGroupLayout = device.createBindGroupLayout({
	label: "Cell Bind Group Layout",
	entries: [{
		binding: 0,
		visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,	// es una flag que indica en qué etapas del shader pueden usar el recurso
		buffer: {}  // Grid uniform buffer, el default
		// podría indicar otros tipos de recursos en lugar buffer: texture, sampler, etc
	}, {
		binding: 1,
		visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
		buffer: { type: "read-only-storage" } // Cell state input buffer
	}, {
		binding: 2,
		visibility: GPUShaderStage.COMPUTE,
		buffer: { type: "storage" }	// Cell state output buffer (storage = read_write)
	}]
});

const pipelineLayout = device.createPipelineLayout({
	label: "Cell Pipeline Layout",
	bindGroupLayouts: [ bindGroupLayout ],
}); // El orden de los bind group layours tiene que coincider con los atributos @group en el shader

// Crear una render pipeline (para usar vertex y fragment shaders)
const cellPipeline = device.createRenderPipeline({
	label: "Cell pipeline",
	layout: pipelineLayout,
	vertex: {
		module: cellShaderModule,
		entryPoint: "vertexMain",
		buffers: [vertexBufferLayout]
	},
	fragment: {
		module: cellShaderModule,
		entryPoint: "fragmentMain",
		targets: [{
			format: canvasFormat
		}]
	}
});
/* El layout de la pipeline describe qué inputs (además de vertex buffers) necesita. Con auto lo hace automaticamente a partir de los shaders.
buffers es un array con objetos GPUVertexBufferLayout que describen cómo se almacena la data en los vertex buffers con los que uso la pipeline.
targets es un array de diccionarios que dan info sobre el color attachment al cual envía el resultado la pipeline. Una info es el formato 
de la textura. Tienen que concicir con los dados a las texturas en colorAttachments de los render passes con los que se usa esta pipeline. En 
este caso, mi render pass usa texturas del canvas context, y usa el formato guardado en canvasFormat */

// Crear una compute pipeline (para usar los compute shaders)
const simulationPipeline = device.createComputePipeline({
	label: "Simulation pipeline",
	layout: pipelineLayout,
	compute: {
		module: simulationShaderModule,
		entryPoint: "computeMain",
	}
});

/* Crear un bind group, que es una colección de recursos que quiero pasar al shader. Devuelve un handle opaco e inmutable. Pero sí se puede
cambiar el contenido de los recursos que está pasando */
const bindGroups = [
	device.createBindGroup({
		label: "Cell renderer bind group A",
		layout: bindGroupLayout,
		entries: [{
			binding: 0, // 0 corresponde al @binding(n) en el shader.
			resource: { buffer: uniformBuffer } // el recurso que quiero pasarle a la variable en el binding index especificado
		}, {
			binding: 1,
			resource: { buffer: cellStateStorage[0] }
		}, {
			binding: 2,
			resource: { buffer: cellStateStorage[1] }
		}],
	}),
	device.createBindGroup({
		label: "Cell renderer bind group B",
		layout: bindGroupLayout,
		entries: [{
			binding: 0,
			resource: { buffer: uniformBuffer }
		}, {
			binding: 1,
			resource: { buffer: cellStateStorage[1] }
		}, {
			binding: 2,
			resource: { buffer: cellStateStorage[0] }
		}],
	})
];

// Lo que sigue es rendering (y ahora compute) code, lo pongo adentro de una función para loopearlo
function updateGrid(){
	const encoder = device.createCommandEncoder();

	const computePass = encoder.beginComputePass();

	computePass.setPipeline(simulationPipeline);
	computePass.setBindGroup(0, bindGroups[step % 2]);
	/* indicarle al shader cuántos workgroups ejecutar en cada eje. 
	El shader se ejecutará 32*32 veces: La grilla es 32x32. El workgroup size es 8, entonces despacho 32/8 workgroups en cada eje, cada uno de 8*8.
	Es más eficiente redondear para arriba la cantidad de workgroups, y en el shader returnear temprano si se supera una global_invocation_id
	*/
	const workgroupCount = Math.ceil(GRID_SIZE / WORKGROUP_SIZE);
	computePass.dispatchWorkgroups(workgroupCount, workgroupCount);

	computePass.end();

	step++;

	// Iniciar un render pass (que usará los resultados del compute pass)

	const pass = encoder.beginRenderPass({
		colorAttachments: [{
			view: context.getCurrentTexture().createView(),
			loadOp: "clear",
			clearValue: [0, 0, 0.4, 1],
			storeOp: "store",
		}]
	});

	// Dibujar la grilla
	pass.setPipeline(cellPipeline); 			// indicar qué pipeline usar para dibujar (shaders, layout de vert. data, etc)
	pass.setVertexBuffer(0, vertexBuffer); 		// indico el buffer que contiene los vértices, 0 porque es el 0th element en la definición de vertex.buffers

	/* Le digo a WebGPU que use este bindgroup. 0 corresponde a @group(0) del shader. Cada @binding que es parte de @group(0) usará los recursos 
	de este bind group*/
	pass.setBindGroup(0, bindGroups[step % 2]);			

	pass.draw(vertices.length /2, GRID_SIZE*GRID_SIZE);	// 6 vertices. renderizados n^2 veces

	pass.end(); // finaliza el render pass

	device.queue.submit([encoder.finish()]);
}

// Preparar updateGrid para ejecutarse repetidamente
setInterval(updateGrid, UPDATE_INTERVAL);
