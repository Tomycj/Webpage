
// defino un uniform llamado grid, un 2d float vector
@group(0) @binding(0) var<uniform> grid: vec2f;

// Vertex shader; función ejecutada por la GPU por cada vertex en el vertexbuffer (el mío tiene 6 posiciones (vértices))
@vertex // indica que es un vertex shader
fn vertexMain(@location(0) pos: vec2f,                          //tomo el buffer con location 0 y lo guardo en variable pos de tipo vec2f				
              @builtin(instance_index) instance: u32) ->        //guardo la variable predefinida instance_index en una variable que llamo instance
   
    @builtin(position) vec4f {

    let i = f32(instance); //guarda el instance index como float. Se conoce como "casting" the type (from u32 to float)
    let cell = vec2f(i % grid.x, floor(i/grid.x)); // let significa const, osea que la variable no cambiará. Las sumas, restas, multip. y div. son element-wise
    let cellOffset = cell / grid *2;

    let gridPos = (pos + 1) / grid -1 + cellOffset;
    
    return vec4f(gridPos, 0, 1);

}

// Fragment shader; ejecutada por cada pixel en cada triángulo que se generó a partir de los vértices. Devuelve un color RGBA
@fragment
fn fragmentMain() -> @location(0) vec4f {
    return vec4f(1, 0, 0, 1);
}
				