export function computeDistancesShader(ne, lp, nr) { return /*wgsl*/`

    struct DatosElementaries { // Cada elemento de un array en un uniform buffer tiene que ser múltiplo de 16B
        cant: u32, // cantidades no acumuladas
        cantAcum2: u32,
        padding2: u32,
        padding3: u32,
    }

    struct DatosInteracciones {
        list: vec2u,                // lista de interacciones (Y Y Y R Y P R R...)
        distAcums: vec2u,
    }

    // struct Rule {
    //     tarInd: f32,
    //     srcInd: f32,
    //     g: f32,
    //     q: f32,
    //     mind: f32,
    //     maxd: f32,
    //     pad1: f32,
    //     pad2: f32,
    // }

    @group(0) @binding(0) var<storage, read> posiciones: array<vec4f>;

    @group(1) @binding(3) var<storage, read_write> distancias: array<f32>;
    //@group(1) @binding(2) var<uniform> rules: array<Rule,1>;
    @group(2) @binding(0) var<uniform> nd: u32; // cantidad total de distancias. Se deja para reemplazarse por otras cosas en el futuro
    @group(2) @binding(1) var<uniform> ints: array<DatosInteracciones, ${lp}>;
    @group(2) @binding(2) var<uniform> elems: array<DatosElementaries,${ne}>;

    override constante = 64; // Este valor es el default, si "constante" no está definida en constants de la pipeline.

    // fn LFSR( z: u32, s1: u32, s2: u32, s3: u32, m:u32) -> u32 {
    //     let b = (((z << s1) ^ z) >> s2);
    //     return (((z & m) << s3) ^ b);
    // }

    // fn rng(i: u32) -> f32 {
    //     let seed = u32(i*1099087573);
    //     let z1 = LFSR(seed,13,19,12, u32(429496729));
    //     let z2 = LFSR(seed,2,25,4, u32(4294967288));
    //     let z3 = LFSR(seed,3,11,17, u32(429496280));
    //     let z4 = 1664525 * seed + 1013904223;
    //     let r0 = z1^z2^z3^z4;
    //     return f32( r0 ) * 2.3283064365387e-10 ;
    // }

    @compute
    @workgroup_size(constante, 1, 1) // el tercer parámetro (z) es default 1.
    fn computeMain(@builtin(global_invocation_id) ind: vec3u) {
        
        let i = ind.x; // index global
        if i >= nd {
            return;
        }

        // Determinar en qué índice de Distancias estoy
        var k = 0;
        while i >= ints[k].distAcums[0] {  //distsAcums[k][0] { // ver si se puede hacer con distAcum2, así no necesito ambos arrays
            k++;
        }

        // Determinar máx filas y máx columnas

        let ef = ints[k].list[0]; //list[k][0]; // índice del elementary en las filas
        let ec = ints[k].list[1];//list[k][1];

        let fmax = elems[ef].cant;
        let cmax = elems[ec].cant;

        // Determinar índice local
        let il = i - ints[k].distAcums[1];//distsAcums[k][1];

        // Determinar en qué fila y columna local estoy
        let f = il / (cmax); // es conveniente que sea unsigned division
        let c = il % (cmax);

        //TODO: optimizar para casos en donde la matriz de distancias es simétrica

        // Calcular distancia

        // let p1 = vec2f( // Está mal porque asume que posiciones es [x1 y1 z1 w1 x2 y2...] cuando es [p1, p2, p3]... con p = xyzw
        //     posiciones[ cantsAcum2[ec]*4  + c*4 + 0 ],
        //     posiciones[ cantsAcum2[ec]*4  + c*4 + 1 ]
        //     //,
        //     //posiciones[cants[cmax] * 4 + c * 4 + 2], // = 0 (2d)
        //     //posiciones[cants[cmax] * 4 + c * 4 + 3], // = 1
        // );
        // let p2 = vec2f(
        //     posiciones[ cantsAcum2[ef]*4 + f*4 + 0],
        //     posiciones[ cantsAcum2[ef]*4 + f*4 + 1]
        //     //,
        //     //posiciones[cants[elementary_f] * 4 + f * 4 + 2], // = 0 (2d)
        //     //posiciones[cants[elementary_f] * 4 + f * 4 + 3], // = 1
        // );

        let p1 = posiciones[ elems[ef].cantAcum2 + f].xy;
        let p2 = posiciones[ elems[ec].cantAcum2 + c].xy;


        distancias[i] = distance(p1, p2);

        //distancias[i] = f32(rules[0].maxd);
        //distancias[i] = f32(${nr});
        distancias[i] = p1.y;
    }
`;
}

export function computeShader(nr) { return /*wgsl*/`

    struct Params {
        n: f32,
        ne: f32,
        ancho: f32,
        alto: f32,
    }

    struct Rule {
        tarInd: f32,
        srcInd: f32,
        g: f32,
        q: f32,
        mind: f32,
        maxd: f32,
        pad1: f32,
        pad2: f32,
    }


    @group(0) @binding(0) var<storage, read> positionsIn: array<vec4f>; // read only
    @group(0) @binding(1) var<storage, read_write> positionsOut: array<vec4f>; //al poder write, lo uso como output del shader

    @group(1) @binding(0) var<uniform> params: Params; // parameters
    @group(1) @binding(1) var<storage, read_write> velocities: array<vec4f>; //al poder write, lo uso como output del shader
    @group(1) @binding(2) var<uniform> rules: array<Rule,${nr}>;
    @group(1) @binding(3) var<storage, read_write> distancias: array<f32>;
    @group(1) @binding(4) var<storage> cantidades: array<u32>; // creo que son acumuladas
    @group(1) @binding(5) var<storage> radios: array<f32>;
    //@group(1) @binding(6) var<storage> colores: array<vec4f>;
    

    override constante = 64; // Este valor es el default, si "constante" no está definida en constants de la pipeline.

    fn LFSR( z: u32, s1: u32, s2: u32, s3: u32, m:u32) -> u32 {
        let b = (((z << s1) ^ z) >> s2);
        return (((z & m) << s3) ^ b);
    }

    fn rng(i: u32) -> f32 {
        let seed = u32(i*1099087573);
        let z1 = LFSR(seed,13,19,12, u32(429496729));
        let z2 = LFSR(seed,2,25,4, u32(4294967288));
        let z3 = LFSR(seed,3,11,17, u32(429496280));
        let z4 = 1664525 * seed + 1013904223;
        let r0 = z1^z2^z3^z4;
        return f32( r0 ) * 2.3283064365387e-10 ;
    }

    fn applyrule( seed: u32, posi: vec2f, posj: vec2f , d:f32, g: f32, q: f32, rmin: f32, rmax: f32 ) -> vec2f {

        // Vf = dT * M2*G*d(vector)/d^3 + V0   cuadrática
        if d>rmax {
            return vec2f(0.0, 0.0);
        }

        if d>=rmin {
            let f = -g/(d*d);
            return vec2f(f*(posi.x - posj.x), f*(posi.y - posj.y));
        }
         else {
            return 0 * vec2f(rng(seed+u32(posj.x))-0.5, rng(seed+u32(posj.y))-0.5) * 2 * g * q;
        }
    }

    @compute
    @workgroup_size(constante, 1, 1) // el tercer parámetro (z) es default 1.
    fn computeMain(@builtin(global_invocation_id) ind: vec3u){

        //var arraydematrices2d = array<array<array<f32>>>;
        
        let i = ind.x; // index global
        let n = u32(params.n);

        if i >= n {
            //velocities[i].z = f32(100);//vel.x;
            return;
        }
        
        var k = u32(0); // índex local: indica el índice de elementary

        while i >= cantidades[k] { // si cantidades[k] es 3, los índices locales van de 0 a 2
           k++;
        }
        
        //let k2 = f32(k);
        
        //var vel = f32(0);
        // if k2 == 0 {
        //     vel = 0;
        // } else if k2 == 1 {
        //     vel = 1;
        // } else if k2 == 2 {
        //     vel = 2;
        // } else if k2 == 3 {
        //     vel = 3;
        // } else {
        //     vel = -1;
        // }

        let pos = positionsIn[i].xy;
        var vel = velocities[i].xy;
        var deltav = vec2f(0.0, 0.0);

        //POR CADA PARTÍCULA CON LA QUE TIENE INTERACCIONES {
        for (var pj: u32 = 0; pj < n; pj++) {

            if pj == i {continue;}

            //determinar elementary index de pj
            var kj = u32(0);
            while pj >= cantidades[kj] { kj++; }

            // por cada regla:
            for (var r: u32 = 0; r<${nr}; r++) {

                // revisar si esta regla le afecta y pj es source
                if k == u32(rules[r].tarInd) && kj == u32(rules[r].srcInd) {

                    //Obtengo la posición de pj
                    let posj = positionsIn[pj].xy;

                    //Obtengo la distancia a pj
                    let d = distance(pos, posj);



                    deltav += applyrule(i, pos, posj, d, rules[r].g, rules[r].q, rules[r].mind, rules[r].maxd);
                
                }

            }
        }

        //let ran1 = rng(u32(floor(pos.x*767890651)))-0.5;
        //let ran2 = rng(u32(floor(pos.y*796789673)))-0.5;
        //let ran1 = (rng(i+u32(pos.x))-0.5)*2;
        //let ran2 = rng(i)-0.5;
        //deltav = vec2f( ran1, ran2);
        //velocities[i].z = ran1;

        vel = (vel + deltav) * 0.995;
        let candidatepos = pos + vel;

        // Colisiones
        if abs(candidatepos.x) > params.ancho/2 {
            vel.x *= -0.8;
        }
        if abs(candidatepos.y) > params.alto/2 {
            vel.y *= -0.8;
        }


        //positionsOut[i] = positionsIn[i] + vec4f(velocities[i], 0.0);
        positionsOut[i].x = pos.x + vel.x;
        positionsOut[i].y = pos.y + vel.y;
        
        
        //positionsOut[i] = vec4f(f32(i)*20, 0,0,1);

        //positionsOut[i] = positionsIn[i] + vec4f( applyrule(i, pos.xy, pos.xy, 1.0, 1.0, 0.5, ), 0, 1);


        //velocities[i] = vec3f(vel, 0.0);
        velocities[i].x = vel.x;
        velocities[i].y = vel.y;
        //velocities[i].z = (rng(i+u32(pos.x))-0.5)*10000;
        
        


    }
`;
}

export function renderShader() { return /*wgsl*/`

    struct Params {
        n: f32,
        ne: f32,
        ancho: f32,
        alto: f32,
    }

    @group(0) @binding(0) var<storage, read> updatedpositions: array<vec4<f32>>; // read only
    //@group(0) @binding(1) var<storage, read_write> unused: array<vec4<f32>>; // PositionsOut de compute. Coordenadas absolutas

    @group(1) @binding(0) var<uniform> params: Params; // parameters
    //@group(1) @binding(1) var<storage, read_write> velocity: array<vec2<f32>>; //al poder write, lo uso como output del shader
    //@group(1) @binding(2) var<uniform> rules: vec2f;
    //@group(1) @binding(3) var<storage, read_write> distancias: array<f32>;
    @group(1) @binding(4) var<storage> cantidades: array<u32>; // Aunque es constante, como no se el largo del array a priori, necesito usar storage
    @group(1) @binding(5) var<storage> radios: array<f32>;
    @group(1) @binding(6) var<storage> colores: array<vec4f>;

// VERTEX SHADER

struct VertexInput {
    @builtin(instance_index) instance: u32, // índice de cada instancia. Hay N instancias.
    @builtin(vertex_index) vertex: u32, // índice de cada vértices. Hay 6 vertices.
    @location(0) pos: vec2f, // índice 0 de la lista de vertex attributes en el vertex buffer layout.
};

struct VertexOutput{
    @builtin(position) pos: vec4f, // posición de cada vértice  || para el fragment shader, al parecer usa un sist. coords distinto (abs from top left)
    @location(1) idx: f32, // Índice de instancia
    @location(3) quadpos: vec2f,
};


@vertex
fn vertexMain(input: VertexInput) -> VertexOutput   {

    let idx = input.instance;

    let ancho = params.ancho;
    let alto = params.alto;
    let ar = ancho/alto;

    var k = u32(0);
    while idx >= cantidades[k] {
        k++;
    }
    
    let diameter = f32(radios[k])*2/ancho; // diámetro en clip space  [-1 1]

    // OUTPUT
    var output: VertexOutput;
    output.pos = vec4f( input.pos.x      * diameter + updatedpositions[idx].x*2/ancho, // Se trabajó con coordenadas absolutas, y ahora se pasan a relativas
                        input.pos.y * ar * diameter + updatedpositions[idx].y*2/alto,
                        0, 1);
    //output.pos = vec4f(input.pos.x + 0, input.pos.y, 0, 1);
    output.idx = f32(idx); // índice de cada instancia, pasado a float para el fragment shader

    output.quadpos = input.pos;

    return output;
}


// FRAGMENT SHADER 


@fragment   
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {  // @location(n) está asociado al índice n del colorAttachment en el renderpass a utilizar

    let r = length(input.quadpos);
    if r > 1 { discard; }
    //var r = length(input.quadpos);
    //if r > 1 { r=0.1; }
    var idx = input.idx;

    if idx == 0 {
        idx = 0;
    }

    var k = u32(0);
    while idx >= f32(cantidades[k]) {
        k++;
    }

    let negro = step (r, 0.85);
    let colnegro = vec4f(negro, negro, negro, 1);

    //return vec4f(r, r, r, 1 );
    
    return colores[k]*colnegro;

}



`
}

/////////////////////////////////////////////////// shaders viejos:

export function computeShaderOLD(sz=8, N=0) { return /*wgsl*/`

    @group(0) @binding(0) var<uniform> canvasdims: vec2f; // recibir el grid size de un uniform buffer
    @group(0) @binding(1) var<storage> initialpositions: array<vec4<f32>>; // read only
    @group(0) @binding(2) var<storage, read_write> finalpositions: array<vec4<f32>>; //al poder write, lo uso como output del shader
    @group(0) @binding(3) var<storage, read_write> velocity: array<vec2<f32>>; //al poder write, lo uso como output del shader

    //override constante = 64; Este valor es el default, si "constante" no está definida en constants de la pipeline.

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
    @workgroup_size(${sz}, 1, 1) // el tercer parámetro (z) es default 1.
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

export function renderShaderOLD() { return /*wgsl*/`

@group(0) @binding(0) var<uniform> canvasdims: vec2f; // uniform buffer
@group(0) @binding(1) var<storage> updatedpositions: array<vec4<f32>>; // storage buffer, u32 coincide con el Uint32 array en java
//@group(0) @binding(2) var<storage, read_write> updatedpositions: array<vec4<f32>>; //al poder write, lo uso como output del shader

// VERTEX SHADER

struct VertexInput {
    @location(0) pos: vec2f, //A
    @builtin(instance_index) instance: u32,
};

struct VertexOutput{
    @builtin(position) pos: vec4f,
    //@location(0) pcoord: vec2f, //A
    @location(1) idx: f32, //B
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
    //output.pcoord = output.pos.xy;
    output.idx = idx;
    return output;

}


// FRAGMENT SHADER 


@fragment   
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {  // @location(n) está asociado al índice n del colorAttachment en el renderpass a utilizar

    //let offset = vec2f(-0.2, 0);
    //let ppos = input.ppos.xy;

    //let diff = vec2f(input.pos-ppos/10000);
    let px = input.pos.x / 1000;
    let py = input.pos.y;

    //let dist = f32( length(diff) );

    return vec4f(input.idx/10000, 1-input.idx/10000, 0, 1 );

}



`
}

////////////////////////////////////////////////////

export function computeShaderNBody() { return /*wgsl*/`

    // TODO AQUÍ ES EN UNIDADES DE PÍXELES DEL CANVAS
    struct Params {
        deltaTime: f32,
        rmin: f32,
        rmax: f32,
        g: f32,
        lims: vec2f,
        n: f32,
        pd: f32,
        colorshift: f32,
    }

    //@group(0) @binding(0) var<uniform> params : mat2x4<f32>; // compute
    @group(0) @binding(0) var<uniform> params : Params;
    @group(0) @binding(1) var<storage, read> positionsIn : array<vec4f>; // positionsIn.w será la masa de cada partícula
    @group(0) @binding(2) var<storage, read_write> positionsOut : array<vec4f>; 
    @group(0) @binding(3) var<storage, read_write> velocities : array<vec4f>;   // velocities.w puede usarse para el radio de cada partícula
    
    override constante = 64; //Este valor es el default, si "constante" no está definida en constants de la pipeline.

    fn attractor( posi: vec2f, posj: vec2f , k: f32, rmin: f32, rmax: f32) -> vec2<f32> {

        let d = posj - posi;
        let r = length(d);

        if r > rmax {
            return vec2<f32>(0.0, 0.0);
        }
        if r > rmin {
            return k * d / (r*r*r);
        }
        return vec2<f32>(0.0, 0.0);
        
    }

    @compute
    @workgroup_size(constante, 1, 1) // el tercer parámetro (z) es default 1.
    fn computeMain(@builtin(global_invocation_id) ind: vec3u) {

        // índice y datos de partícula a modificar
        let i = ind.x;
        let pos = positionsIn[i].xy;
        var vel = velocities[i].xy;

        // Fuerzas modifican la velocidad

        for (var i: i32 = 0; i < i32(params.n); i++) {

            vel += attractor(pos, positionsIn[i].xy, params.g, params.rmin, params.rmax);

        }
        // Revisar colisiones
        let candidatepos = pos + vel;
        if abs(candidatepos.x) > params.lims.x {
            vel.x *= -.1;
        }
        if abs(candidatepos.y) > params.lims.y {
            vel.y *= -.1;
        }

        // Sobreescribir datos de partícula al buffer
        positionsOut[i].x = pos.x + vel.x; // positionsOut[i].xy = pos + vel; // Tira error por algún motivo
        positionsOut[i].y = pos.y + vel.y;
        velocities[i].x = vel.x;
        velocities[i].y = vel.y;
    }
`;
}

export function renderShaderNBody() { return /*wgsl*/`

    struct Params {
        deltaTime: f32,
        rmin: f32,
        rmax: f32,
        g: f32,
        lims: vec2f,
        n: f32,
        pd: f32,
        colorshift: f32,
    }

    //@group(0) @binding(0) var<uniform> params: mat2x4<f32>; // shader
    @group(0) @binding(0) var<uniform> params: Params; // shader
    @group(0) @binding(1) var<storage> updatedpositions: array<vec4<f32>>; // PositionsOut de compute. Coordenadas absolutas

    // VERTEX SHADER

    struct VertexInput {
        @builtin(instance_index) instance: u32, // índice de cada instancia. Hay N instancias.
        @builtin(vertex_index) vertex: u32, // índice de cada vértices. Hay 6 vertices.
        @location(0) pos: vec2f, // índice 0 de la lista de vertex attributes en el vertex buffer layout.
    };

    struct VertexOutput{
        @builtin(position) pos: vec4f, // posición de cada vértice  || para el fragment shader, al parecer usa un sist. coords distinto (abs from top left)
        @location(1) idx: f32, // Índice de instancia
        @location(3) quadpos: vec2f,
    };

    @vertex
    fn vertexMain(input: VertexInput) -> VertexOutput   {

        let idx = input.instance;

        let ancho = params.lims.x;
        let alto = params.lims.y;
        let ar = ancho/alto;
        let diameter = params.pd; // diámetro en clip space

        // OUTPUT
        var output: VertexOutput;
        output.pos = vec4f( input.pos.x      * diameter + updatedpositions[idx].x/ancho, // Se trabajó con coordenadas absolutas, y ahora se pasan a relativas
                            input.pos.y * ar * diameter + updatedpositions[idx].y/alto,
                            0, 1);

        output.idx = f32(idx); // índice de cada instancia, pasado a float para el fragment shader

        output.quadpos = input.pos;

        return output;
    }

    // FRAGMENT SHADER 

    fn hueShift( color: vec3f, hueAdjust: f32 ) -> vec3f {

        let kRGBToYPrime = vec3f (0.299, 0.587, 0.114);
        let kRGBToI      = vec3f (0.596, -0.275, -0.321);
        let kRGBToQ      = vec3f (0.212, -0.523, 0.311);
    
        let kYIQToR     = vec3f (1.0, 0.956, 0.621);
        let kYIQToG     = vec3f (1.0, -0.272, -0.647);
        let kYIQToB     = vec3f (1.0, -1.107, 1.704);
    
        let YPrime  = dot (color, kRGBToYPrime);
        var I       = dot (color, kRGBToI);
        var Q       = dot (color, kRGBToQ);
        var hue     = atan2 (Q, I);
        let chroma  = sqrt (I * I + Q * Q);
    
        hue += hueAdjust;
    
        Q = chroma * sin (hue);
        I = chroma * cos (hue);
    
        let   yIQ   = vec3f (YPrime, I, Q);
    
        return vec3f( dot (yIQ, kYIQToR), dot (yIQ, kYIQToG), dot (yIQ, kYIQToB) );
    
    }


    @fragment   
    fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {  // @location(n) está asociado al índice n del colorAttachment en el renderpass a utilizar

        let r = length(input.quadpos);
        if r > 1 {
            discard;
        }

        //let color = params.color;

        let color = vec3f(1, 1-r, 0);

        let negro = step (r, 0.8);

        return vec4f( hueShift(color, params.colorshift) * 1 , 1 );

    }

`
}

export function renderShaderNBodyB() { return /*wgsl*/`     // Dibuja particulas radiales sin requerir vertex buffers extra

    struct Params {
        deltaTime: f32,
        rmin: f32,
        rmax: f32,
        g: f32,
        lims: vec2f,
        n: f32,
    }

    //@group(0) @binding(0) var<uniform> params: mat2x4<f32>; // shader
    @group(0) @binding(0) var<uniform> params: Params; // shader
    @group(0) @binding(1) var<storage> updatedpositions: array<vec4<f32>>; // PositionsOut de compute. Coordenadas absolutas

    // VERTEX SHADER

    struct VertexInput {
        @builtin(instance_index) instance: u32, // índice de cada instancia. Hay N instancias.
        @builtin(vertex_index) vertex: u32, // índice de cada vértices. Hay 6 vertices.
        @location(0) pos: vec2f, // índice 0 de la lista de vertex attributes en el vertex buffer layout.
    };

    struct VertexOutput{
        @builtin(position) pos: vec4f, // posición de cada vértice  || para el fragment shader, al parecer usa un sist. coords distinto (abs from top left)
        @location(1) idx: f32, // Índice de instancia
        @location(2) posi: vec2f, // intento: posición de cada partícula
    };

    @vertex
    fn vertexMain(input: VertexInput) -> VertexOutput   {

        let idx = input.instance;

        let ancho = params.lims.x;
        let alto = params.lims.y;
        let ar = ancho/alto;
        let diameter = f32(0.02); // diámetro en clip space

        // OUTPUT
        var output: VertexOutput;
        output.pos = vec4f( input.pos.x      * diameter + updatedpositions[idx].x/ancho, // Se trabajó con coordenadas absolutas, y ahora se pasan a relativas
                            input.pos.y * ar * diameter + updatedpositions[idx].y/alto,
                            0, 1);
                            //vec4f(pfinal, 0, 1);

        output.idx = f32(idx); // índice de cada instancia, pasado a float para el fragment shader

        output.posi = vec2f( updatedpositions[idx].x/2,
                             updatedpositions[idx].y/2,
                            );

        return output;
    }

    // FRAGMENT SHADER 
    @fragment   
    fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {  // @location(n) está asociado al índice n del colorAttachment en el renderpass a utilizar

        let pos1 = (input.pos.xy - params.lims/2) * vec2f(1.0, -1.0) ; // pixel position centralizada absoluta
        let pos2 = input.posi;  // particle position centralizada absoluta

        let pos1r = vec2f(pos1.x / (params.lims.x/2), pos1.y / (params.lims.y/2)); //posiciones centrales relativas
        let pos2r = vec2f(pos2.x / (params.lims.x/2), pos2.y / (params.lims.y/2));
        //let pos2r = vec2f() pos2 / 1000;

        var r = length( pos1 - pos2 ); //-input.pos); // posi es un valor que aumenta desde el centro, parece que parte desde 1
        //r = length(pos1);

        if (r > 6) {
           discard;
        }

        //return vec4f(input.idx/25, 1-input.idx/25, 0, 1 );
        //return vec4f(input.pos.x/985 * m, input.pos.y/512 * m, 0, 1 );
        return vec4f(pos2r, 0, 1 );
        // Tiene problemas: al iniciar estando con mucho zoom, se ven cuadradas.
    }

`
}