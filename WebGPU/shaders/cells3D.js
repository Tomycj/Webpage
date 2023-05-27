
export function computeShader(sz=8, N=0) { return /*wgsl*/`

    @group(0) @binding(0) var<uniform> canvasdims: vec2f; // recibir el grid size de un uniform buffer
    @group(0) @binding(1) var<storage> initialpositions: array<vec4<f32>>; // read only
    @group(0) @binding(2) var<storage, read_write> finalpositions: array<vec4<f32>>; //al poder write, lo uso como output del shader
    @group(0) @binding(3) var<storage, read_write> velocity: array<vec2<f32>>; //al poder write, lo uso como output del shader

    fn attractor( posi: vec2f, posj: vec2f , k: f32, rmin: f32) -> vec2f {

        let d = posj - posi;
        let r = length(d);

        if r > rmin {
            return k * d / (r*r*r);
        } else {
            return vec2f(0, 0);
        }
        

    }

    @compute
    @workgroup_size(${sz}, 1, 1) // el tercer parámetro (z) es default 1
    fn computeMain(@builtin(global_invocation_id) ind: vec3u){

        let i = ind.x;

        let positioni = vec4f(initialpositions[i]);
        var vel = vec4f(velocity[i], 0, 0);

        for (var i: i32 = 0; i < ${N}; i++) {
            
            vel += vec4f(attractor(positioni.xy, initialpositions[i].xy, 2.0, 3.0), 0, 0);

        }


        //vel += vec4f(attractor(positioni.xy, vec2f(100, 0), 10, 5.0), 0, 0);



        let candidatepos = positioni + vel;
        let lims = canvasdims;
        if abs(candidatepos.x) > lims.x {
            vel.x *= -.1;
        }
        if abs(candidatepos.y) > lims.y{
            vel.y *= -.1;
        }


        finalpositions[i] = positioni + vel;
        velocity[i] = vel.xy;
    }

`;
}


export function renderShader() { return /*wgsl*/`

@group(0) @binding(0) var<uniform> canvasdims: vec2f; // uniform buffer
@group(0) @binding(1) var<storage> updatedpositions: array<vec4<f32>>; // storage buffer, u32 coincide con el Uint32 array en java
//@group(0) @binding(2) var<storage, read_write> updatedpositions: array<vec4<f32>>; //al poder write, lo uso como output del shader

// VERTEX SHADER

struct VertexInput {
    @location(5) pos: vec2f,
    @builtin(instance_index) instance: u32,
};

struct VertexOutput{
    @builtin(position) pos: vec4f,
    @location(5) pcoord: vec2f,
    @location(4) idx: f32,
};

// de momento N = manualmente, luego veo cómo pasar N a este shader.

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput   {

    let ar = canvasdims.x / canvasdims.y;
    //convertir de clip space [-1 1] a [canvasmin canvasmax]
    var pabs = input.pos * canvasdims;

    //actualmente los vértices están en las esquinas del clipspace. Los hago cuadrados:
    let pradius = f32(1);
    pabs = (pabs / canvasdims) * pradius; // particle size
    
    //desplazar instancias
    let idx = f32(input.instance);

    pabs = pabs + updatedpositions[input.instance].xy;

    //volver a clip space
    let pfinal = pabs / canvasdims;

    // OUTPUT
    var output: VertexOutput;
    output.pos = vec4f(pfinal, 0, 1);
    output.pcoord = output.pos.xy;
    output.idx = idx;
    return output;

}


// FRAGMENT SHADER 

struct FragInput {
    @location(5) pos: vec2f, // clip space position of each pixel
    @builtin(position) ppos: vec4f, // canvas space position of each pixel
    @location(4) idx: f32, // instance index
    //@location(3) ipos: vec2f, //instance position
};

struct FragOutput { //sin usar de momento
    @location(5) color: vec4f,
};

@fragment   
fn fragmentMain(input: FragInput) -> @location(0) vec4f {

    //let offset = vec2f(-0.2, 0);
    //let ppos = input.ppos.xy;

    //let diff = vec2f(input.pos-ppos/10000);
    let px = input.ppos.x / 1000;
    let py = input.ppos.y;

    //let dist = f32( length(diff) );

    return vec4f(input.idx/10000, 1-input.idx/10000, 0, 1 );

}



`
}