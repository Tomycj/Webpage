// Cada elemento de un array en un uniform buffer tiene que ser múltiplo de 16B
// TODO: Visualizar mapa de densidad de partículas
export function computeDistancesShader(sz, nd) { return /*wgsl*/`
    
    struct DatosElementaries {
        cant: u32,
        cantAcum: u32,
        cantAcum2: u32,
        radio: f32,
        color: vec4f,
    }

    struct DatosInteracciones {
        list: vec2u,                // lista de interacciones (Y Y Y R Y P R R...)
        distAcum: u32,
        distAcum2: u32,
    }

    @group(0) @binding(0) var<storage, read> posiciones: array<vec4f>;

    @group(1) @binding(3) var<storage, read_write> distancias: array<f32>;
    @group(1) @binding(4) var<storage> elems: array<DatosElementaries>;
    @group(1) @binding(5) var<storage> ints: array<DatosInteracciones>;

    @compute
    @workgroup_size(${sz}, 1, 1)
    fn computeMain(@builtin(global_invocation_id) ind: vec3u) {
        
        let i = ind.x; // index global
        if i >= ${nd} {
            return;
        }

        // Determinar en qué índice de Distancias estoy
        var k = 0;
        while i >= ints[k].distAcum {  //distsAcums[k][0] { // ver si se puede hacer con distAcum2, así no necesito ambos arrays
            k++;
        }

        // Determinar máx filas y máx columnas

        let ef = ints[k].list[0]; // índice del elementary en las filas
        let ec = ints[k].list[1];

        let fmax = elems[ef].cant;
        let cmax = elems[ec].cant;

        // Determinar índice local
        let il = i - ints[k].distAcum2;

        // Determinar en qué fila y columna local estoy
        let f = il / (cmax); // es conveniente que sea unsigned division
        let c = il % (cmax);

        //TODO: optimizar para casos en donde la matriz de distancias es simétrica

        // Calcular distancia

        //TODO: Alternativa: sparse matrix NxN, guardar ahí las distancias. Así es más fácil acceder a ellas luego.

        let p1 = posiciones[ elems[ef].cantAcum2 + f].xy;
        let p2 = posiciones[ elems[ec].cantAcum2 + c].xy;

        distancias[i] = distance(p1, p2);

    }
    `;
}

export function computeShader(sz) { return /*wgsl*/`

    struct Params { 
        ancho: f32,
        alto: f32,
        n: u32,
        ne: u32,

        nr: u32,
        nd: u32,
        lp: u32,
        frictionInv: f32,

        bounceF: f32,
        borderStart: f32, // not used in compute shader
        spherical: f32,
        padding: f32,   // to get to 48 bytes.

        seeds: vec4f, // requires to be aligned to 16 bytes
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

    struct DatosElementaries {
        cant: u32,
        cantAcum: u32,
        cantAcum2: u32,
        radio: f32,
        color: vec4f,
    }

    // Bindings 
        @group(0) @binding(0) var<storage, read> positionsIn: array<vec4f>; // read only
        @group(0) @binding(1) var<storage, read_write> positionsOut: array<vec4f>; //al poder write, lo uso como output del shader

        @group(1) @binding(0) var<uniform> params: Params; // parameters
        @group(1) @binding(1) var<storage, read_write> velocities: array<vec4f>; //al poder write, lo uso como output del shader
        @group(1) @binding(2) var<storage> rules: array<Rule>;
        @group(1) @binding(3) var<storage, read_write> distancias: array<f32>;
        @group(1) @binding(4) var<storage> elems: array<DatosElementaries>;
    //
    //https://indico.cern.ch/event/93877/contributions/2118070/attachments/1104200/1575343/acat3_revised_final.pdf
    fn LFSR( z: u32, s1: u32, s2: u32, s3: u32, m:u32) -> u32 {
        let b = (((z << s1) ^ z) >> s2);
        return (((z & m) << s3) ^ b);
    }
    fn rng(i: u32) -> f32 {
        let seed = i*1099087573;
        let z1 = LFSR(seed,13,19,12, u32(4294967294));
        let z2 = LFSR(seed,2 ,25,4 , u32(4294967288));
        let z3 = LFSR(seed,3 ,11,17, u32(4294967280));
        let z4 = 1664525 * seed + 1013904223;
        let r0 = z1^z2^z3^z4;
        return f32( r0 ) * 2.3283064365387e-10 ;
    }
    
    // rng mostrado en Hello Triangle demos:
    var<private> seed : vec2u;
    var<private> rand_seed : vec2f;

    fn init_rng2(invocation_id : u32, seed : vec4<f32>) {
        rand_seed = seed.xz;
        rand_seed = fract(rand_seed * cos(35.456 + f32(invocation_id) * seed.yw));
        rand_seed = fract(rand_seed * cos(41.235 + f32(invocation_id) * seed.xw));
    }

    fn rng2() -> f32 {
        rand_seed.x = fract(cos(dot(rand_seed, vec2<f32>(23.14077926, 232.61690225))) * 136.8168);
        rand_seed.y = fract(cos(dot(rand_seed, vec2<f32>(54.47856553, 345.84153136))) * 534.7645);
        return rand_seed.y;
    }
  
    fn applyrule2( posi: vec2f, posj: vec2f , d:f32, g: f32, q: f32, rmin: f32, rmax: f32 ) -> vec2f {
        // Usa el rng mostrado en HelloTriangle
        if d > rmax {
            return vec2f();
        }
        if d >= rmin {
            let f = -g/(d*d);
            return vec2f(posi.x - posj.x, posi.y - posj.y) * f;
        }
        return (vec2f(rng2(), rng2()) * 2 - 1) * q;
    }
    
    /*
        fn elemIndex(i: u32) -> u32 { // elementary index using cantAcum (doesn't work for manually placed particles)
            var k = u32();
            while i >= elems[k].cantAcum {k++;}
            return k;
        }
        
        fn applyrule( seedinput: vec2u, posi: vec2f, posj: vec2f , d:f32, g: f32, q: f32, rmin: f32, rmax: f32 ) -> vec2f {

            // Vf = dT * M2*G*d(vector)/d^3 + V0   cuadrática
            if d>rmax {
                return vec2f();
            }
            if d>=rmin {
                let f = -g/(d*d);
                return vec2f(posi.x - posj.x, posi.y - posj.y) * f;
            }
            seed = seedinput + vec2u(posj);
            return (vec2f(rng(seed.x), rng(seed.y)) * 2 - 1) * q;
        }

        fn applyrule_classic( seed: u32, posi: vec2f, posj: vec2f , d:f32, g: f32, q: f32, rmin: f32, rmax: f32 ) -> vec2f {
            // hace los ifs en el orden de la versión original de cells.
            if (d > rmin && d < rmax) {
                let f = -g/(d*d);
                return vec2f(f*(posi.x - posj.x), f*(posi.y - posj.y)); 
            }

            if d < rmin {

                let sx = u32(floor(posi.y + posj.x)) * (3 + 1099087573);
                let sy = u32(ceil(posi.x + posj.y)) * (7 + 1099087573);

                return ( vec2f(rng(seed), rng(seed)) - 0.5 )* 2 * q;
            }
            return vec2f(0.0, 0.0);
        }
    */

    @compute
    @workgroup_size(${sz}, 1, 1) // el tercer parámetro (z) es default 1.
    fn computeMain(@builtin(global_invocation_id) ind: vec3u){

        let i = ind.x; // index global
        let n = params.n;

        if i >= n {
            return;
        }

        init_rng2(i, params.seeds);
        //seed = vec2u(i, i);
        //var iterations = u32(); // debug iterations counter
        
        let k = u32(positionsIn[i].w); // pos.w is used as elementary index.

        var pos = positionsIn[i].xy;
        var vel = velocities[i].xy;
        var deltav = vec2f();
        var kj = u32(); // elementary index de pj
        
        // por cada regla:  -- Es mucho más eficiente tomar el loop más corto como el más externo.
        for (var r: u32 = 0; r < params.nr; r++) {

            if k != u32(rules[r].tarInd) { continue; }

            // Por cada partícula:
            for (var pj: u32 = 0; pj < n; pj++) {

                if pj == i {continue;}
                
                kj = u32(positionsIn[pj].w);
                
                //iterations++;
                // revisar si esta regla le afecta y pj es source
                if kj == u32(rules[r].srcInd) {

                    // Obtengo la posición de pj
                    let posj = positionsIn[pj].xy;
                    let ilj = pj - elems[kj].cantAcum2; // índice local de pj

                    // Obtengo la distancia a pj
                    let d = distance(pos, posj);
                    
                    //deltav += applyrule(seed, pos, posj, d, rules[r].g, rules[r].q, rules[r].mind, rules[r].maxd);
                    deltav += applyrule2(pos, posj, d, rules[r].g, rules[r].q, rules[r].mind, rules[r].maxd);
                }
            }
        }

        vel = (vel + deltav) * params.frictionInv;

        pos += vel;

        // Colisiones TODO: Colisiones de alta precisión a altas velocidades (reflejar etc). Bounce dependiente del ángulo de incidencia.
        
        let bordex = params.ancho/2;
        let bordey = params.alto/2;
        let r = elems[k].radio;

        if abs(pos.x) > bordex - r {
            pos.x = 2 * sign(vel.x) * (bordex - r) - (pos.x); // parece que es seguro usar sign: vel nunca es 0 aquí.
            vel.x *= -params.bounceF;
        }
        if abs(pos.y) > bordey - r {
            pos.y = 2 * sign(vel.y) * (bordey - r) - (pos.y);
            vel.y *= -params.bounceF;
        }

        positionsOut[i].x = pos.x;
        positionsOut[i].y = pos.y;
        positionsOut[i].w = positionsIn[i].w; 
        
        velocities[i].x = vel.x;
        velocities[i].y = vel.y;
        //velocities[0].w = // for debugging
    }
    `;
}

export function renderShader() { return /*wgsl*/`

    struct Params { 
        ancho: f32,
        alto: f32,
        n: u32,
        ne: u32,
        nr: u32,
        nd: u32,
        lp: u32,
        frictionInv: f32,
        bounceF: f32,
        borderStart: f32,
        spherical: f32,
        
    }

    struct DatosElementaries {
        cant: u32,
        cantAcum: u32,
        cantAcum2: u32,
        radio: f32,
        color: vec4f,
    }

    // Bindings
        @group(0) @binding(0) var<storage, read> updatedpositions: array<vec4<f32>>; // read only

        @group(1) @binding(0) var<uniform> params: Params; // parameters
        @group(1) @binding(4) var<storage> elems: array<DatosElementaries>;
    //

    // VERTEX SHADER

    struct VertexInput {
        @builtin(instance_index) instance: u32, // índice de cada instancia. Hay N instancias.
        @builtin(vertex_index) vertex: u32, // índice de cada vértices. Hay 6 vertices.
        @location(0) pos: vec2f, // índice 0 de la lista de vertex attributes en el vertex buffer layout.
        // TODO: Ver si puedo traer desde el compute shader al índice de elementary (k).
    };

    struct VertexOutput{
        @builtin(position) pos: vec4f, // posición de cada vértice  || para el fragment shader, al parecer usa un sist. coords distinto (abs from top left)
        @location(1) @interpolate(flat) idx: u32, // Índice de instancia
        @location(2) quadpos: vec2f,
        @location(3) @interpolate(flat) k: u32,
        @location(4) @interpolate(flat) random: f32,
    };

    fn LFSR( z: u32, s1: u32, s2: u32, s3: u32, m:u32) -> u32 {
        let b = (((z << s1) ^ z) >> s2);
        return (((z & m) << s3) ^ b);
    }
    fn rng(i: u32) -> f32 {
        let seed = i*1099087573;
        let z1 = LFSR(seed,13,19,12, u32(4294967294));
        let z2 = LFSR(seed,2 ,25,4 , u32(4294967288));
        let z3 = LFSR(seed,3 ,11,17, u32(4294967280));
        let z4 = 1664525 * seed + 1013904223;
        let r0 = z1^z2^z3^z4;
        return f32( r0 ) * 2.3283064365387e-10 ;
    }

    @vertex
    fn vertexMain(input: VertexInput) -> VertexOutput   {

        let idx = input.instance;

        let ancho = params.ancho;
        let alto = params.alto;
        let ar = ancho/alto;

        let k = u32(updatedpositions[idx].w);
        
        let diameter = f32(elems[k].radio) * 2 / ancho; // diámetro en clip space  [-1 1]

        // OUTPUT
        var output: VertexOutput;
        output.pos = vec4f(
            input.pos.x      * diameter + updatedpositions[idx].x * 2 / ancho, // Se trabajó con coordenadas absolutas, y ahora se pasan a relativas
            input.pos.y * ar * diameter + updatedpositions[idx].y * 2 / alto,
            0, 1);

        output.idx = idx; // índice de cada instancia, pasado a float para el fragment shader
        output.quadpos = input.pos;
        output.k = k;
        output.random = mix(0.8, 1.2, rng(idx) );

        return output;
    }

    // FRAGMENT SHADER 

    @fragment   
    fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {  // @location(n) está asociado al índice n del colorAttachment en el renderpass a utilizar

        let r = length(input.quadpos);
        if r > 1 { discard; }

        let idx = input.idx;
        let k = input.k;
        
        return elems[k].color * step(r, params.borderStart) * input.random * ( 1 + params.spherical * (sqrt(1 - r*r) - 1) );

    }
    `;
}

export function computeShaderConDistancias(sz) { return /*wgsl*/`

    struct Params { 
        ancho: f32,
        alto: f32,
        n: u32,
        ne: u32,
        nr: u32,
        nd: u32,
        lp: u32,
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

    struct DatosElementaries {
        cant: u32,
        cantAcum: u32,
        cantAcum2: u32,
        radio: f32,
        color: vec4f,
    }
    /*
    struct DatosInteracciones {
        list: vec2u, // lista de interacciones (Y Y Y R Y P R R...)
        distAcum: u32,
        distAcum2: u32,
    }*/

    // Bindings 
        @group(0) @binding(0) var<storage, read> positionsIn: array<vec4f>; // read only
        @group(0) @binding(1) var<storage, read_write> positionsOut: array<vec4f>; //al poder write, lo uso como output del shader

        @group(1) @binding(0) var<uniform> params: Params; // parameters
        @group(1) @binding(1) var<storage, read_write> velocities: array<vec4f>; //al poder write, lo uso como output del shader
        @group(1) @binding(2) var<storage> rules: array<Rule>;
        @group(1) @binding(3) var<storage, read_write> distancias: array<f32>;
        @group(1) @binding(4) var<storage> elems: array<DatosElementaries>;
    //  @group(1) @binding(5) var<uniform> ints: array<DatosInteracciones, ${lp}>;
        @group(1) @binding(6) var<uniform> params2: vec4f; // CPU random numbers y demás
    //
    //https://indico.cern.ch/event/93877/contributions/2118070/attachments/1104200/1575343/acat3_revised_final.pdf
    fn LFSR( z: u32, s1: u32, s2: u32, s3: u32, m:u32) -> u32 {
        let b = (((z << s1) ^ z) >> s2);
        return (((z & m) << s3) ^ b);
    }
    fn rng(i: u32) -> f32 {
        let seed = i*1099087573;
        let z1 = LFSR(seed,13,19,12, u32(4294967294));
        let z2 = LFSR(seed,2 ,25,4 , u32(4294967288));
        let z3 = LFSR(seed,3 ,11,17, u32(4294967280));
        let z4 = 1664525 * seed + 1013904223;
        let r0 = z1^z2^z3^z4;
        return f32( r0 ) * 2.3283064365387e-10 ;
    }
    
    // rng mostrado en Hello Triangle demos:
    var<private> seed : vec2u;
    var<private> rand_seed : vec2f;

    fn init_rng2(invocation_id : u32, seed : vec4<f32>) {
        rand_seed = seed.xz;
        rand_seed = fract(rand_seed * cos(35.456 + f32(invocation_id) * seed.yw));
        rand_seed = fract(rand_seed * cos(41.235 + f32(invocation_id) * seed.xw));
    }

    fn rng2() -> f32 {
        rand_seed.x = fract(cos(dot(rand_seed, vec2<f32>(23.14077926, 232.61690225))) * 136.8168);
        rand_seed.y = fract(cos(dot(rand_seed, vec2<f32>(54.47856553, 345.84153136))) * 534.7645);
        return rand_seed.y;
    }

    fn elemIndex(i: u32) -> u32 {
        var k = u32(0);
        while i >= elems[k].cantAcum {k++;}
        return k;
    }
    
    fn applyrule2( posi: vec2f, posj: vec2f , d:f32, g: f32, q: f32, rmin: f32, rmax: f32 ) -> vec2f {
        // Usa el rng mostrado en HelloTriangle
        if d > rmax {
            return vec2f();
        }
        if d >= rmin {
            let f = -g/(d*d);
            return vec2f(posi.x - posj.x, posi.y - posj.y) * f;
        }
        return (vec2f(rng2(), rng2()) * 2 - 1) * q;
    }
    /*
    fn applyrule( seedinput: vec2u, posi: vec2f, posj: vec2f , d:f32, g: f32, q: f32, rmin: f32, rmax: f32 ) -> vec2f {

        // Vf = dT * M2*G*d(vector)/d^3 + V0   cuadrática
        if d>rmax {
            return vec2f();
        }
        if d>=rmin {
            let f = -g/(d*d);
            return vec2f(posi.x - posj.x, posi.y - posj.y) * f;
        }
        seed = seedinput + vec2u(posj);
        return (vec2f(rng(seed.x), rng(seed.y)) * 2 - 1) * q;
    }

    fn applyrule_classic( seed: u32, posi: vec2f, posj: vec2f , d:f32, g: f32, q: f32, rmin: f32, rmax: f32 ) -> vec2f {
        // hace los ifs en el orden de la versión original de cells.
        if (d > rmin && d < rmax) {
            let f = -g/(d*d);
            return vec2f(f*(posi.x - posj.x), f*(posi.y - posj.y)); 
        }

        if d < rmin {

            let sx = u32(floor(posi.y + posj.x)) * (3 + 1099087573);
            let sy = u32(ceil(posi.x + posj.y)) * (7 + 1099087573);

            return ( vec2f(rng(seed), rng(seed)) - 0.5 )* 2 * q;
        }
        return vec2f(0.0, 0.0);
    }*/

    @compute
    @workgroup_size(${sz}, 1, 1) // el tercer parámetro (z) es default 1.
    fn computeMain(@builtin(global_invocation_id) ind: vec3u){

        let i = ind.x; // index global
        let n = params.n;

        velocities[i].z = 0.0;
        if i >= n {
            return;
        }

        init_rng2(i, params2);
        //seed = vec2u(i, i);
        var iterations = u32(); // debug iterations counter
        

        //let il = i - elems[k].cantAcum2;    // índice local de la partícula
        let k = elemIndex(i);
        let pos = positionsIn[i].xy;
        var vel = velocities[i].xy;
        var deltav = vec2f();
        var kj = u32(); // elementary index de pj
        
        // Por cada partícula:
        for (var pj: u32 = 0; pj < n; pj++) {
            if pj == i {continue;}
            kj = elemIndex(pj);

            //var d = f32(0);

            // por cada regla:
            for (var r: u32 = 0; r < params.nr; r++) {

                iterations++;

                // revisar si esta regla le afecta y pj es source
                if k == u32(rules[r].tarInd) && kj == u32(rules[r].srcInd) {

                    // Obtengo la posición de pj
                    let posj = positionsIn[pj].xy;
                    let ilj = pj - elems[kj].cantAcum2; // índice local de pj
                    // Obtengo la distancia a pj
                    let d = distance(pos, posj);
                    
                    // Busco el índice del par de interacción en el array de matrices distancias
                    /*
                    for (var inter: u32 = 0; inter < params.lp; inter++) {
                        
                        if ((ints[inter].list.x == k) && (ints[inter].list.y == kj)) {
                            // k son las filas, kj las columnas. En la matriz de distancias
                            
                            // let offset = ints[inter].distAcum2;

                            // // Determinar índice 1d en la matriz de distancias
                            // let cmax = elems[kj].cant; //cantidad de columnas
                            // let c = pj - elems[kj].cantAcum2;    // índice de columna = índice local de pj

                            // let index = (il * cmax) + c;     //índice 1d local en la matriz de distancias (il = índ. fila)
                            // d = distancias[offset + index];
                            
                            d = distancias[ints[inter].distAcum2 + il * elems[kj].cant + ilj];
                            break;
                        }
                        
                        if ((ints[inter].list.x == kj) && (ints[inter].list.y == k)) {
                            // k son las columnas, kj las filas. En la matriz de distancias
                            
                            // let offset = ints[inter].distAcum2;
                            // let cmax = elems[k].cant;   // cantidad de columnas
                            // let c = il;     // índice de columna = índice local de k
                            // let ilj = pj - elems[kj].cantAcum2;    // índ. de fila = índice local de pj

                            // let index = (ilj * cmax) + c;
                            // d = distancias[offset + index];
                            
                            d = distancias[ints[inter].distAcum2 + ilj * elems[k].cant + il];
                            break;
                        }
                    }*/

                    //deltav += applyrule(seed, pos, posj, d, rules[r].g, rules[r].q, rules[r].mind, rules[r].maxd);
                    deltav += applyrule2(pos, posj, d, rules[r].g, rules[r].q, rules[r].mind, rules[r].maxd);
                }
            }
        }
        velocities[i].z = deltav.x;

        vel = (vel + deltav) * 0.995;
        let candidatepos = pos + vel;

        // Colisiones
        if abs(candidatepos.x) > params.ancho/2 - elems[k].radio {
            vel.x *= -0.8;
        }
        if abs(candidatepos.y) > params.alto/2 - elems[k].radio {
            vel.y *= -0.8;
        }

        positionsOut[i].x = pos.x + vel.x;
        positionsOut[i].y = pos.y + vel.y;
        
        velocities[i].x = vel.x;
        velocities[i].y = vel.y;
    }
    `;
}