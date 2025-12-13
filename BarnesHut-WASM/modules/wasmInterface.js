const WASM_PATH = new URL("../wasm/barnesHut.wasm", import.meta.url);
const PAGESIZE_BYTES = 65_536;

const TREE_XTRA_MEM_FACTOR = 1;

const externablyMutableGlobalKeys = new Set(["N", "dt", "g", "epsilon", "theta"]);

const importObj = {
    tags: {
        errorTag: new WebAssembly.Tag({parameters: ["f32"]})
    },
    functions: {
        log: console.log
    },
    constants: {
        nLimit: 260_000,
        dims: null,
    },
    vars: {

        // Params
        N:          new WebAssembly.Global({value: "i32", mutable: true}),
        dt:         new WebAssembly.Global({value: "f32", mutable: true}),
        g:          new WebAssembly.Global({value: "f32", mutable: true}),
        epsilon:    new WebAssembly.Global({value: "f32", mutable: true}),
        theta:      new WebAssembly.Global({value: "f32", mutable: true}),

        // Point data offsets
        pointIndsByteOffset:        new WebAssembly.Global({value: "i32", mutable: true}),
        pointPositionsByteOffset:   new WebAssembly.Global({value: "i32", mutable: true}),
        pointMassesByteOffset:      new WebAssembly.Global({value: "i32", mutable: true}),
        pointVelsByteOffset:        new WebAssembly.Global({value: "i32", mutable: true}),
        colBordersByteOffset:       new WebAssembly.Global({value: "i32", mutable: true}),
        sqBBoxByteOffset:           new WebAssembly.Global({value: "i32", mutable: true}),

        // Tree
        treeRootWidth:              new WebAssembly.Global({value: "f32", mutable: true}),
        nodesByteOffset:            new WebAssembly.Global({value: "i32", mutable: true}),
        nodePtsBgnByteOffset:       new WebAssembly.Global({value: "i32", mutable: true}),
        nodeMassesAndCoMByteOffset: new WebAssembly.Global({value: "i32", mutable: true}),
        colBordersByteOffset:       new WebAssembly.Global({value: "i32", mutable: true}),
    },
    memories: {
        tree: null,
        points: null,
    }
    
}

let instance;
let allocatedPointPages = 0;
let allocatedTreePages = 0;

function createTreeMemory(nodesAmount, bytesPerNode) {

    const nodesByteLength = nodesAmount * bytesPerNode;
    const nodePtsBgnByteLength = (nodesAmount + 1) * 4; // u32
    const nodeMassesAndCoMByteLength = nodesAmount * 12; // 3xf32

    const nodesByteOffset      = 0;
    const nodePtsBgnByteOffset = nodesByteOffset + nodesByteLength;
    const nodeMassesAndCoMByteOffset = nodePtsBgnByteOffset + nodePtsBgnByteLength;

    const treeMemoryRawByteLength = nodeMassesAndCoMByteOffset + nodeMassesAndCoMByteLength;

    const treePagesAmount = Math.ceil(treeMemoryRawByteLength * TREE_XTRA_MEM_FACTOR / PAGESIZE_BYTES);

    importObj.memories.tree = new WebAssembly.Memory({initial: treePagesAmount});
    allocatedTreePages = treePagesAmount;
}

function createPointsMemory(N, dimensions) {

    const memoryByteLength = (2*(N + dimensions*(N+2))) * Float32Array.BYTES_PER_ELEMENT; // inds, x, y, m, vx, vy, collision borders, bounding box

    const pagesAmount = Math.ceil(memoryByteLength / PAGESIZE_BYTES);

    importObj.memories.points = new WebAssembly.Memory({initial: pagesAmount});
    allocatedPointPages = pagesAmount;
}


function remapPointsMemory(N, dimensions) {

    const requiredPages = Math.ceil((2*(N + dimensions*(N+2))) * Float32Array.BYTES_PER_ELEMENT / PAGESIZE_BYTES);

    if (requiredPages > allocatedPointPages) {
        importObj.memories.points.grow(requiredPages - allocatedPointPages);
        allocatedPointPages = requiredPages;
    }
    else if (requiredPages < allocatedPointPages / 4) {
        importObj.memories.points = new WebAssembly.Memory({initial: requiredPages});
    }

    const buffer = importObj.memories.points.buffer;

    const pointInds  = new Uint32Array (buffer, 0,                                             N           );
    const points     = new Float32Array(buffer, pointInds.byteOffset  + pointInds.byteLength,  N*dimensions);
    const pMasses    = new Float32Array(buffer, points.byteOffset     + points.byteLength,     N           );
    const vels       = new Float32Array(buffer, pMasses.byteOffset    + pMasses.byteLength,    N*dimensions);
    const colBorders = new Float32Array(buffer, vels.byteOffset       + vels.byteLength,       2*dimensions);
    const sqBBox     = new Float32Array(buffer, colBorders.byteOffset + colBorders.byteLength, 2*dimensions);

    importObj.vars.pointIndsByteOffset.value = pointInds.byteOffset;
    importObj.vars.pointPositionsByteOffset.value = points.byteOffset;
    importObj.vars.pointMassesByteOffset.value = pMasses.byteOffset;
    importObj.vars.pointVelsByteOffset.value = vels.byteOffset;
    importObj.vars.colBordersByteOffset.value = colBorders.byteOffset;
    importObj.vars.sqBBoxByteOffset.value = sqBBox.byteOffset;
    
    return {pointInds, points, pMasses, vels, colBorders, sqBBox};
}


function setTreeMemory(tree) {
    // Set and fill tree memory: nodes, nodePointsBegin, nodeMasses&Coms.

    const nodesAmount = tree.nodes.length;

    const nodesByteLength = nodesAmount * tree.BYTES_PER_NODE;
    const nodePtsBgnByteLength = (nodesAmount + 1) * 4; // u32
    const nodeMassesAndCoMByteLength = nodesAmount * 12; // 3xf32

    const nodesByteOffset      = 0;
    const nodePtsBgnByteOffset = nodesByteOffset + nodesByteLength;
    const nodeMassesAndCoMByteOffset = nodePtsBgnByteOffset + nodePtsBgnByteLength;

    const requiredBytes = nodeMassesAndCoMByteOffset + nodeMassesAndCoMByteLength
    const requiredPages = Math.ceil((requiredBytes)/PAGESIZE_BYTES);

    if (requiredPages > allocatedTreePages) {

        const newPagesAmount = (Math.ceil(requiredBytes * TREE_XTRA_MEM_FACTOR / PAGESIZE_BYTES));

        importObj.memories.tree.grow(newPagesAmount - allocatedTreePages);
        allocatedTreePages = newPagesAmount;
    }


    importObj.vars.treeRootWidth.value = tree.rootWidth;

    importObj.vars.nodesByteOffset.value = nodesByteOffset;
    importObj.vars.nodePtsBgnByteOffset.value = nodePtsBgnByteOffset;
    importObj.vars.nodeMassesAndCoMByteOffset.value = nodeMassesAndCoMByteOffset;


    const nodesView = new DataView(importObj.memories.tree.buffer);

    // fill nodes
    for (let i = 0, byteInd = 0; i < nodesAmount; i++, byteInd += tree.BYTES_PER_NODE) {
        
        const node = tree.nodes[i];

        /* INDEXING EXPLANATION
            node[0]    is the node index               -> will use this one as a basis in WAT. Will be tltd to node byte offset, com byte offset, etc.
            node[0]*CHILDREN PER NODE  is the index of the flat array (*4)
            node[0]*BYTES PER NODE is the byte offset of the flat array (*16 = *(CHILDREN PER NODE * BYTES PER CHILD))
        */
        nodesView.setUint32(byteInd,    node[0], true);
        nodesView.setUint32(byteInd+4,  node[1], true);
        nodesView.setUint32(byteInd+8,  node[2], true);
        nodesView.setUint32(byteInd+12, node[3], true);
    }
    // fill nodePointsBegin
    for (let i = 0, byteInd = nodePtsBgnByteOffset; i < tree.nodePointsBegin.length; i++, byteInd += 4) {
        nodesView.setUint32(byteInd, tree.nodePointsBegin[i] * 4, true); // By multiplying by 4 I am storing the byte offset instead of the index.
    }
    // fill masses and CoM (interleaved)
    for (let i = 0, byteInd = nodeMassesAndCoMByteOffset; i < tree.coms.length; i+=3, byteInd += 12) {
        nodesView.setFloat32(byteInd,   tree.coms[i  ], true);
        nodesView.setFloat32(byteInd+4, tree.coms[i+1], true);

        nodesView.setFloat32(byteInd+8, tree.coms[i+2], true);
    }

}

function processNewFrame(tree, dt, iterations) {

    setTreeMemory(tree);

    for (let i = 0; i < iterations; i++) {
        instance.exports.advanceTime(dt);
    }
}

function updateGlobalIfPresent(key, value) {

    if (!externablyMutableGlobalKeys.has(key)) return false;

    importObj.vars[key].value = value;
    return true;
}




const throwInitError = () => {throw new SyntaxError("Must initialize() first");}

export const barnesHutWasm = {

    async initialize(treeNodesLength, treeBytesPerNode, params, dimensions) {
        
        const {N, dt, g, epsilon, theta} = params;

        createTreeMemory(treeNodesLength, treeBytesPerNode);
        createPointsMemory(N, dimensions);

        const pointDataMappings = remapPointsMemory(N, dimensions);
        
        importObj.constants.dims = dimensions;

        importObj.vars.N.value = N;
        importObj.vars.dt.value = dt;
        importObj.vars.g.value = g;
        importObj.vars.epsilon.value = epsilon;
        importObj.vars.theta.value = theta;

        ({instance} = await WebAssembly.instantiateStreaming(fetch(WASM_PATH), importObj));

        this.setTreeMemory = setTreeMemory;
        this.processNewFrame = processNewFrame;
        this.updateGlobalIfPresent = updateGlobalIfPresent;
        this.remapPointsMemory = remapPointsMemory;

        return pointDataMappings;
    },

    setTreeMemory: throwInitError,
    processNewFrame: throwInitError,
    updateGlobalIfPresent: throwInitError,
    remapPointsMemory: throwInitError,
}

//TODO: Instead of having dynamic point data offsets, recompile code with them as constants when N changes. Test perf dif.