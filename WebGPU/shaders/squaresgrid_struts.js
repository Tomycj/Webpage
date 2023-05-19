export function squaresGrid_Struts (ext=0) { return /* wgsl */`

    struct VertexInput {
        @location(0) pos: vec2f,
        @builtin(instance_index) instance: u32,
    };

    struct VertexOutput{
        @builtin(position) pos: vec4f,
        @location(0) cell: vec2f,
    };

    @group(0) @binding(0) var<uniform> grid: vec2f; // uniform buffer
    @group(0) @binding(1) var<storage> cellState: array<u32>; // storage buffer, u32 coincide con el Uint32 array en java

    @vertex
    fn vertexMain(input: VertexInput) -> VertexOutput   {

        let i = f32(input.instance); 
        let cell = vec2f(i % grid.x, floor(i/grid.x)); 
        let state = f32(cellState[input.instance]); // cast to f32. El índice de cellState tiene que ser u32 o i32

        let cellOffset = cell / grid *2;

        let gridPos = (input.pos*state + 1) / grid -1 + cellOffset;
        
        var output: VertexOutput;
        output.pos = vec4f(gridPos, 0, 1);
        output.cell = cell;
        return output;

    }


    /* Sin usar structs:

    @fragment
    fn fragmentMain(location(0) cell: vec2f) -> @location(0) vec4f {
        return vec4f(cell, 0, 1);
    } 

    Usando structs:  */ 

    struct FragInput {
        @location(0) cell: vec2f,
    };
    @fragment   
    fn fragmentMain(input: FragInput) -> @location(0) vec4f {
        let c = input.cell / grid;
        return vec4f(c, 1-c.x, ${ext});
    }

`;
}

export function gol(sz) { return /*wgsl*/`
    @group(0) @binding(0) var<uniform> grid: vec2f; // recibir el grid size de un uniform buffer

    @group(0) @binding(1) var<storage> cellStateIn: array<u32>; // read only
    @group(0) @binding(2) var<storage, read_write> cellStateOut: array<u32>; //al poder write, lo uso como output del shader

    // Mapea las coords de la celda a un array 1D.  Hace un efecto de wrap around para los bordes.
    fn cellIndex(cell: vec2u) -> u32 {
        return (cell.y % u32(grid.y)) * u32(grid.x) +
               (cell.x % u32(grid.x));
    }
    // Devuelve el estado de una coordenada dada.
    fn cellActive(x: u32, y: u32) -> u32 {
        return cellStateIn[cellIndex(vec2(x, y))];
    }

    @compute
    @workgroup_size(${sz}, ${sz}) // el tercer parámetro (z) es default 1
    fn computeMain(@builtin(global_invocation_id) cell: vec3u){

        // Contar la cantidad de vecinos vivos
        let activeNeighbors = cellActive(cell.x+1, cell.y+1) +
                              cellActive(cell.x+1, cell.y) +
                              cellActive(cell.x+1, cell.y-1) +
                              cellActive(cell.x, cell.y-1) +
                              cellActive(cell.x-1, cell.y-1) +
                              cellActive(cell.x-1, cell.y) +
                              cellActive(cell.x-1, cell.y+1) +
                              cellActive(cell.x, cell.y+1);

        let i = cellIndex(cell.xy);

        switch (activeNeighbors) {
            case 2: {
                cellStateOut[i] = cellStateIn[i];
            }
            case 3: {
                cellStateOut[i] = 1;
            }
            default: {
                cellStateOut[i] = 0;
            }
        }
    }

`;
}