;; wat2wasm barnesHut.wat -o barnesHut.wasm --enable-multi-memory

(module
    (import "tags" "errorTag" (tag $tooLargeError (param f32)))
    (import "functions" "log" (func $logi (param i32)))
    (import "functions" "log" (func $logf (param f32)))

    (import "constants" "nLimit"    (global $nLimit i32))
    (import "constants" "dims"      (global $dims i32))

    ;; Params
    (import "vars" "N"          (global $N          (mut i32)))
    (import "vars" "dt"         (global $dt         (mut f32)))
    (import "vars" "g"          (global $G          (mut f32)))
    (import "vars" "epsilon"    (global $epsilon    (mut f32)))
    (import "vars" "theta"      (global $theta      (mut f32)))
    ;; Point data offsets
    (import "vars" "pointIndsByteOffset"       (global $ofs1 (mut i32)))
    (import "vars" "pointPositionsByteOffset"  (global $ofs2 (mut i32)))
    (import "vars" "pointMassesByteOffset"     (global $ofs3 (mut i32)))
    (import "vars" "pointVelsByteOffset"       (global $ofs4 (mut i32)))
    (import "vars" "colBordersByteOffset"      (global $ofs8 (mut i32)))
    ;; Tree
    (import "vars" "treeRootWidth"              (global $treeRootWidth (mut f32)))
    (import "vars" "nodesByteOffset"            (global $ofs5 (mut i32)))
    (import "vars" "nodePtsBgnByteOffset"       (global $ofs6 (mut i32)))
    (import "vars" "nodeMassesAndCoMByteOffset" (global $ofs7 (mut i32)))
    
    (import "memories" "tree"  (memory $tree 1))
    (import "memories" "points" (memory $points 1))


    (global $x (mut f32) f32.const 0)
    (global $y (mut f32) f32.const 0)

    (global $bytesPerNode i32 i32.const 16) 
    (global $bytesPerNodePtsBgn i32 i32.const 4) 
    (global $bytesPerCom i32 i32.const 12)
    (global $pIndToMassIndFactor i32 i32.const 2)

    (global $bytesPerPoint i32 i32.const 8) ;; dimensions * 4B
    (global $bytesPerPointCoodinate i32 i32.const 4) ;; 4B 

    (func $traverseBH (param $nodeInd i32) (param $width f32) (result f32 f32)

        (local $nodeByteOfs i32) ;; Byte offset of current node.
        (local $childrenInds v128) 

        (local $start i32) ;; auxiliary variables for loop inside first if statement.
        (local $end i32)
        (local $j i32)

        (local $ax f32)
        (local $ay f32)

        (local $dx f32)
        (local $dy f32)

        (local $dsq f32)

        (local $comIndOffset i32)

        (local $childInd i32)

        (local $tempi i32)
        (local $tempf f32)

        (local.set $nodeByteOfs (i32.mul (local.get $nodeInd) (global.get $bytesPerNode)))

        (local.set $ax (f32.const 0))
        (local.set $ay (f32.const 0))

        ;; if the i32 value at that offset is 0, that means that either that child is null, or the node is a leaf.
        ;; if ALL 4 i32 values of the node are 0, the node is a leaf.

        (local.tee $childrenInds (v128.load $tree (local.get $nodeByteOfs)))
        
        v128.any_true
        i32.eqz

        if ;; node is leaf
            ;; const start = tree.nodePointsBegin[nodeInd]; traducido a WAT, where indices are byte offsets
            ;; const end = tree.nodePointsBegin[nodeInd+1];
            ;; offset of start value = nodePointsBegin's byteOffset + this node's offset inside nodePointsBegin.
            ;; the end value is = nodePointsBegin's byteOffset + the next node's offset inside nodePointsBegin (previous + 4B).
            (local.set $start
                (i32.load $tree
                    (i32.add (global.get $ofs6) (i32.mul (local.get $nodeInd) (global.get $bytesPerNodePtsBgn))) 
                )
            )
            (local.set $end
                (i32.load $tree 
                    (i32.add (global.get $ofs6) (i32.add (i32.mul (local.get $nodeInd) (global.get $bytesPerNodePtsBgn)) (i32.const 4))) 
                )
            )

            ;; loop as long as start < end

            (block $break
                (loop $continue
                    
                    local.get $start
                    local.get $end
                    i32.ge_u
                    br_if $break ;; break if start >= end (continue if start < end)

                    (i32.load $points (i32.add (global.get $ofs1) (local.get $start))) ;; const j = pointInds[k];  push "j" to stack

                    local.tee $j ;; j is the index of the point to load, in the flat array of point positions.
                    ;; I have to convert it to the byte offset:

                    global.get $bytesPerPointCoodinate
                    i32.mul
                    global.get $ofs2 ;; point positions start byte offset
                    i32.add

                    local.tee $tempi ;; copy j's byteoffset. 
                    ;; j
                    (f32.sub (f32.load $points) (global.get $x)) ;; dx = points[j(as byteoffset)] - x
                    ;; dx
                    local.tee $dx ;; copy dx
                    local.get $dx ;; dx dx
                    f32.mul ;; dx*dx

                    (f32.load $points offset=4 (local.get $tempi)) ;; here needs j.
                    (f32.sub (global.get $y)) ;; dy = points[j+4B] - y
                    ;; dx*dx, dy
                    local.tee $dy ;; copy dy
                    local.get $dy
                    f32.mul ;; dx*dx, dy*dy
                    f32.add
                    global.get $epsilon
                    f32.add
                    ;; dx*dx + dy*dy + e = d

                    local.tee $tempf
                    local.get $tempf
                    ;; d; d
                    f32.sqrt
                    f32.mul ;; d * sqr(d)
                    local.set $tempf 
                    global.get $G
                    ;; load particle mass to compute G*M
                    (f32.load $points (i32.add (global.get $ofs3) (i32.mul (local.get $j) (global.get $pIndToMassIndFactor))))
                    f32.mul
                    local.get $tempf
                    f32.div             ;; fac = G*M / d
                    local.tee $tempf
                    local.get $tempf    ;; fac, fac
                    local.get $dx
                    f32.mul             ;; fac, fax*dx
                    local.get $ax
                    f32.add
                    local.set $ax       ;; ax+= fac*dx
                    local.get $dy       ;; fac, dy
                    f32.mul
                    local.get $ay
                    f32.add
                    local.set $ay       ;; ay+= fac*dy

                    (local.set $start (i32.add (local.get $start) (i32.const 4))) ;; start += 4
                    br $continue
                )
            )

            local.get $ax
            local.get $ay
            return
        end

        ;; is parent. Is far enough?
        
        (local.set $comIndOffset ;; obtain and store the byteoffset of center of mass of this node
            (i32.add
                (global.get $ofs7)                                        ;; starting point of memory section storing CoM y masses
                (i32.mul (local.get $nodeInd) (global.get $bytesPerCom))  ;; offset into that memory section
            )
        )

        (local.tee $dx
            (f32.sub
                (f32.load $tree offset=0 (local.get $comIndOffset))
                (global.get $x)
            )
        )
        local.get $dx
        f32.mul

        (local.tee $dy
            (f32.sub
                (f32.load $tree offset=4 (local.get $comIndOffset))
                (global.get $y)
            )
        )
        local.get $dy
        f32.mul

        f32.add
        global.get $epsilon
        f32.add

        local.tee $dsq

        (local.set $tempf (f32.sqrt)) ;; store d = sqrt(dsq)

        (f32.div (local.get $width) (local.get $tempf))
        global.get $theta

        f32.lt ;; width / d < theta ?

        if
            (f32.load $tree offset=8 (local.get $comIndOffset)) ;; m

            global.get $G
            f32.mul
            local.get $tempf
            local.get $dsq
            f32.mul

            f32.div

            local.tee $tempf ;; store fac = (G * m) / (d * dsq)

            (f32.mul (local.get $dx)) ;; put ax = fac * dx on stack
            (f32.mul (local.get $dy) (local.get $tempf)) ;; put ay on stack
            return
        end

        ;; is a close parent. needs subdivision

        (local.set $width ;; width /= 2
            (f32.mul
                (local.get $width)
                (f32.const 0.5)
            )
        )

        ;; Traverse children if they exist (their offset is not zero)
        (local.tee $childInd (i32x4.extract_lane 0 (local.get $childrenInds))) ;;store child ofs
        if
            (call $traverseBH (local.get $childInd) (local.get $width)) ;; stack: ax, ay
            
            local.get $ay
            f32.add
            local.set $ay

            local.get $ax
            f32.add
            local.set $ax
        end

        (local.tee $childInd (i32x4.extract_lane 1 (local.get $childrenInds)))
        if
            (call $traverseBH (local.get $childInd) (local.get $width))
            (local.set $ay (f32.add (local.get $ay)))
            (local.set $ax (f32.add (local.get $ax)))
        end

        (local.tee $childInd (i32x4.extract_lane 2 (local.get $childrenInds)))
        if
            (call $traverseBH (local.get $childInd) (local.get $width))
            (local.set $ay (f32.add (local.get $ay)))
            (local.set $ax (f32.add (local.get $ax)))
        end

        (local.tee $childInd (i32x4.extract_lane 3 (local.get $childrenInds)))
        if
            (call $traverseBH (local.get $childInd) (local.get $width))
            (local.set $ay (f32.add (local.get $ay)))
            (local.set $ax (f32.add (local.get $ax)))
        end

        local.get $ax
        local.get $ay
    )

    (func $computeSquareBounds (param f32 f32 f32 f32)

        (local $cx f32)
        (local $cy f32)
        (local $halfSide f32)

        (local.set $halfSide 
            (f32.mul
                (f32.max
                    (f32.sub (local.get 2) (local.get 0))
                    (f32.sub (local.get 3) (local.get 1))
                )
                (f32.const 0.5)
            )
        )

        (local.set $cx
            (f32.mul
                (f32.add (local.get 0) (local.get 2))
                (f32.const 0.5)
            )
        )
        (local.set $cy
            (f32.mul
                (f32.add (local.get 1) (local.get 3))
                (f32.const 0.5)
            )
        )

        (f32.store $points offset=16 (global.get $ofs8) (f32.sub (local.get $cx) (local.get $halfSide)))
        (f32.store $points offset=20 (global.get $ofs8) (f32.sub (local.get $cy) (local.get $halfSide)))
        (f32.store $points offset=24 (global.get $ofs8) (f32.add (local.get $cx) (local.get $halfSide)))
        (f32.store $points offset=28 (global.get $ofs8) (f32.add (local.get $cy) (local.get $halfSide)))

    )

    (func $updatePositions (param $dt f32)
    
        (local $x f32)
        (local $y f32)
        (local $vx f32)
        (local $vy f32)

        (local $colBorders v128)

        (local $xmin f32)
        (local $ymin f32)
        (local $xmax f32)
        (local $ymax f32)

        (local $byteOfst i32)
        (local $byteOfstVels i32)

        (local.set $colBorders (v128.load $points (global.get $ofs8)))
        (local.set $xmin (f32.const inf))
        (local.set $ymin (f32.const inf))
        (local.set $xmax (f32.const -inf))
        (local.set $ymax (f32.const -inf))


        (local.set $byteOfst (global.get $ofs2)) ;; start loop at pointPositionsByteOffset
        (local.set $byteOfstVels (global.get $ofs4))

        (loop $forEachParticle

            (local.set $x (f32.load $points          (local.get $byteOfst)))
            (local.set $y (f32.load $points offset=4 (local.get $byteOfst)))

            ;; x += vx*dt
            (local.set $x
                (f32.add 
                    (f32.load $points offset=0 (local.get $byteOfst))
                    (f32.mul (local.get $dt) (f32.load $points offset=0 (local.get $byteOfstVels)))
                )
            )
            (local.set $y
                (f32.add 
                    (f32.load $points offset=4 (local.get $byteOfst))
                    (f32.mul (local.get $dt) (f32.load $points offset=4 (local.get $byteOfstVels)))
                )
            )

            ;; Collision
            local.get $x
            (f32x4.extract_lane 0 (local.get $colBorders))
            f32.lt
            if ;; if x < xBorderMin

                (local.set $x (f32x4.extract_lane 0 (local.get $colBorders))) ;;x = xBorderMin
                (f32.store $points offset=0 (local.get $byteOfstVels) (f32.const 0)) ;; vx = 0

            else
                local.get $x
                (f32x4.extract_lane 2 (local.get $colBorders))
                f32.gt
                if ;; if x > xBorderMax
                    (local.set $x (f32x4.extract_lane 2 (local.get $colBorders))) ;;x = xBorderMax
                    (f32.store $points offset=0 (local.get $byteOfstVels) (f32.const 0)) ;; vx = 0
                end
            end

            local.get $y
            (f32x4.extract_lane 1 (local.get $colBorders))
            f32.lt
            if
                (local.set $y (f32x4.extract_lane 1 (local.get $colBorders)))
                (f32.store $points offset=4 (local.get $byteOfstVels) (f32.const 0))
            else
                local.get $y
                (f32x4.extract_lane 3 (local.get $colBorders))
                f32.gt
                if
                    (local.set $y (f32x4.extract_lane 3 (local.get $colBorders)))
                    (f32.store $points offset=4 (local.get $byteOfstVels) (f32.const 0))
                end
            end

            ;; Write new positions
            (f32.store $points offset=0 (local.get $byteOfst) (local.get $x))
            (f32.store $points offset=4 (local.get $byteOfst) (local.get $y))

            ;; New borders
            (local.set $xmin (f32.min (local.get $xmin) (local.get $x)))
            (local.set $ymin (f32.min (local.get $ymin) (local.get $y)))
            (local.set $xmax (f32.max (local.get $xmax) (local.get $x)))
            (local.set $ymax (f32.max (local.get $ymax) (local.get $y)))

            ;; Prepare next loop
            (local.set $byteOfstVels (i32.add (local.get $byteOfstVels) (global.get $bytesPerPoint)))
            (local.tee $byteOfst (i32.add (local.get $byteOfst) (global.get $bytesPerPoint)))
            global.get $ofs3
            i32.lt_u
            br_if $forEachParticle
        )

        ;; Update square bounding box
        (call $computeSquareBounds (local.get $xmin) (local.get $ymin) (local.get $xmax) (local.get $ymax))
        
    )


    (func (export "advanceTime") (param $dt f32)

        (local $ax f32)
        (local $ay f32)

        (local $byteOfst i32)
        (local $byteOfstVels i32)

        (local.set $byteOfst (global.get $ofs2)) ;; start loop at pointPositionsByteOffset
        (local.set $byteOfstVels (global.get $ofs4))

        (loop $forEachParticle

            (global.set $x (f32.load $points          (local.get $byteOfst)))
            (global.set $y (f32.load $points offset=4 (local.get $byteOfst)))

            (call $traverseBH (i32.const 0) (global.get $treeRootWidth)) ;; ax, ay
            
            (local.set $ay)
            (local.set $ax)

            ;; Update velocities
            ;; vx += ax*dt
            (f32.store $points offset=0 (local.get $byteOfstVels)
                (f32.add 
                    (f32.load $points offset=0 (local.get $byteOfstVels))
                    (f32.mul (local.get $dt) (local.get $ax))
                )
            )
            (f32.store $points offset=4 (local.get $byteOfstVels)
                (f32.add 
                    (f32.load $points offset=4 (local.get $byteOfstVels))
                    (f32.mul (local.get $dt) (local.get $ay))
                )
            )

            (local.set $byteOfstVels (i32.add (local.get $byteOfstVels) (global.get $bytesPerPoint))) ;; byteOfstVels += 8
            (local.tee $byteOfst (i32.add (local.get $byteOfst) (global.get $bytesPerPoint))) ;; byteOfst += 8
            global.get $ofs3    ;; byte offset of next section in the memory (point positions -> [point masses])
            
            i32.lt_u            ;; byteOfst < $ofs3 ?
            br_if $forEachParticle
        )

        (call $updatePositions (local.get $dt))

    )
)

;;TODO: try structs, arrays, referencias.