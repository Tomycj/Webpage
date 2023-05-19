
struct VertexInput {
    @location(0) pos: vec2f,
    @builtin(instance_index) instance: u32,
};

struct VertexOutput{
    @builtin(position) pos: vec4f,
    @location(0) cell: vec2f,
};

@group(0) @binding(0) var<uniform> grid: vec2f;

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput   {

    let i = f32(input.instance); 
    let cell = vec2f(i % grid.x, floor(i/grid.x)); 
    let cellOffset = cell / grid *2;
    let gridPos = (input.pos + 1) / grid -1 + cellOffset;
    
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
    return vec4f(input.cell, 0, 1);
}
