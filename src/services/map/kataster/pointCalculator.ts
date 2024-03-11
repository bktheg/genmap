import { consola } from 'consola';
import {PointDescriptor, AbsolutePointDescriptor, AliasPointDescriptor, AveragePointDescriptor, RelativePointDescriptor, IntersectPointDescriptor, LengthUnit, MultiWayPointDescriptor, PointType, LocalAbsolutePointDescriptor} from '#kataster/pointDescriptors'
import * as m2d from 'math2d';

export function solveLocalCoordinateSystems(p:PointDescriptor):boolean {
    if( p instanceof MultiWayPointDescriptor ) {
        return solveLocalCoordinateSystemFromMultiWayPoint(<MultiWayPointDescriptor>p);
    }
    return false
}

export function calculatePoint(p:PointDescriptor, points:Map<string,PointDescriptor>, strict:boolean):PointDescriptor {
    if( p instanceof RelativePointDescriptor ) {
        return calculateRelativePoint(<RelativePointDescriptor>p, points);
    }
    else if( p instanceof AliasPointDescriptor ) {
        return calculateAliasPoint(<AliasPointDescriptor>p, points);
    }
    else if( p instanceof AveragePointDescriptor ) {
        return calculateAveragePoint(<AveragePointDescriptor>p, points);
    }
    else if( p instanceof IntersectPointDescriptor ) {
        return calculateIntersectPoint(<IntersectPointDescriptor>p, points);
    }
    else if( p instanceof MultiWayPointDescriptor ) {
        return calculateMultiWayPoint(<MultiWayPointDescriptor>p, points, strict);
    }
    else if( p instanceof LocalAbsolutePointDescriptor ) {
        return calculateLocalAbsolutePoint(<LocalAbsolutePointDescriptor>p, points);
    }
    else if( p instanceof AbsolutePointDescriptor ) {
        return p;
    }
    throw "Unknown point descriptor for "+p.id;
}

function calculateLocalAbsolutePoint(lp:LocalAbsolutePointDescriptor, points:Map<string,PointDescriptor>):PointDescriptor {
    return lp;
}

function solveLocalCoordinateSystemFromMultiWayPoint(mp:MultiWayPointDescriptor):boolean {
    const absPoint = mp.descriptors.find(p => p.isAbsolute())
    if( !absPoint ) {
        return false
    }

    let changed = false
    for( const p of mp.descriptors ) {
        if( p instanceof LocalAbsolutePointDescriptor ) {
            const lp = <LocalAbsolutePointDescriptor>p;

            //consola.info("Verbinde lokales Koordinatensystem", lp.localCoordSys.gemeinde.getId(),"-",lp.localCoordSys.flur, "via Punkt", absPoint.id)
            changed = changed || lp.localCoordSys.solve(mp.id, absPoint.getPosition()[0]-lp.x, absPoint.getPosition()[1]-lp.y)
        }
    }

    return changed
}


function calculateMultiWayPoint(mp:MultiWayPointDescriptor, points:Map<string,PointDescriptor>, strict:boolean):PointDescriptor {
    if( mp.isAbsolute() ) {
        return mp;
    }

    let writeDebug = false;
    if( strict ) {
        for( let i=0; i < mp.descriptors.length; i++ ) {
            const d1 = mp.descriptors[i];
            
            for( let j=i; j < mp.descriptors.length; j++ ) {
                const d2 = mp.descriptors[j];
                
                if( d1 instanceof RelativePointDescriptor && d2 instanceof RelativePointDescriptor ) {
                    const r1 = <RelativePointDescriptor>d1;
                    const r2 = <RelativePointDescriptor>d2;

                    if( r1.p1 == r2.p1 && r1.p2 == r2.p2 ) {
                        if( r1.length != r2.length || r1.lengthP1P2 != r2.lengthP1P2 || Math.abs(r1.angle-r2.angle) > 0.01 || r1.unitP1P2 != r2.unitP1P2 ) {
                            consola.warn("Inkonsistenter relativer Vermessungspunkt "+mp.id);
                            writeDebug = true;
                        }
                    }
                }
                else if( d1 instanceof AbsolutePointDescriptor && d2 instanceof AbsolutePointDescriptor ) {
                    const a1 = <AbsolutePointDescriptor>d1;
                    const a2 = <AbsolutePointDescriptor>d2;
                    const delta = 20;

                    if( Math.abs(a1.x-a2.x) > delta || Math.abs(a1.y-a2.y) > delta ) {
                        consola.warn("Inkonsistenter absoluter Vermessungspunkt "+mp.id+": Delta "+Math.round(Math.sqrt(Math.pow(a1.x-a2.x,2)+Math.pow(a1.y-a2.y,2))));
                        writeDebug = true;
                    }
                }
            }
        }
    }

    const resolved:PointDescriptor[] = [];
    for( const p of mp.descriptors ) {      
        const resolvedP = calculatePoint(p, points, strict);
        if( resolvedP != null ) {
            if( strict ) {
                resolved.push(resolvedP);
            }
            else {
                mp.resolve(resolvedP);
                return mp;
            }
        }
    }

    for( let i=0; i < resolved.length; i++ ) {
        const d1 = resolved[i];
        
        for( let j=i; j < resolved.length; j++ ) {
            const d2 = resolved[j];
            
            if( d1.isAbsolute() && d2.isAbsolute() ) {
                const a1 = d1.getPosition();
                const a2 = d2.getPosition();
                const delta = 20;

                if( Math.abs(a1[0]-a2[0]) > delta || Math.abs(a1[1]-a2[1]) > delta ) {
                    consola.warn("Inkonsistenter absoluter Vermessungspunkt "+mp.id+": Delta "+Math.round(Math.sqrt(Math.pow(a1[0]-a2[0],2)+Math.pow(a1[1]-a2[1],2))));
                    writeDebug = true;
                }
            }
        }
    }
    
    if( writeDebug ) {
        let counter = 1;
        for(const p of resolved ) {
            const debugP = new AbsolutePointDescriptor(p.type, `${p.id}v${counter++}`, p.gemeinde, p.getPosition()[0], p.getPosition()[1]);
            points.set(debugP.id, debugP);
        }
    }
    
    if( strict && resolved.length == mp.descriptors.length ) {
        mp.resolve(avg(mp.type, mp.id, resolved));
        return mp;
    }

    return null;
}

function avg(type:PointType, id:string, points:PointDescriptor[]):PointDescriptor {
    let x = 0;
    let y = 0;
    for( const p of points ) {
        const pos = p.getPosition();
        x += pos[0];
        y += pos[1];
    }
    return new AbsolutePointDescriptor(type, id, points[0].gemeinde, x/points.length, y/points.length);
}

function calculateAveragePoint(ap:AveragePointDescriptor, points:Map<string,PointDescriptor>):PointDescriptor {
    let sumX = 0;
    let sumY = 0;
    for( const p of ap.p ) {
        if( points.get(p) == null ) {
            consola.warn("Unknown Point "+ap.p);
            return null;
        }
        if( !points.get(p).isAbsolute() ) {
            return null;
        }

        const absolute = points.get(p).getPosition();
        sumX += absolute[0];
        sumY += absolute[1];
    }
    
    return new AbsolutePointDescriptor(ap.type, ap.id, ap.gemeinde, sumX/ap.p.length, sumY/ap.p.length);
}


function calculateAliasPoint(ap:AliasPointDescriptor, points:Map<string,PointDescriptor>) {
    if( ap.isAbsolute() ) {
        return ap;
    }
    if( points.get(ap.p) == null ) {
        consola.warn("Unknown Point "+ap.p);
        return null;
    }
    if( !points.get(ap.p).isAbsolute() ) {
        return null;
    }
    const p1 = points.get(ap.p);
    ap.resolve(p1);
    return ap;
}

function calculateIntersectPoint(ip:IntersectPointDescriptor, points:Map<string,PointDescriptor>) {
    const vecs:m2d.IVec[] = [];

    if( ip.p.length != 4 ) {
        consola.warn("Illegal Intersection "+ip);
        return null;
    }

    for( const p of ip.p ) {
        if( points.get(p) == null ) {
            consola.warn("Unknown Point "+p);
            return null;
        }
        if( !points.get(p).isAbsolute() ) {
            return null;
        }
        const ap = points.get(p).getPosition();
        vecs.push(m2d.vecReset(ap[0], ap[1]));
    }

    const line1 = m2d.lineThroughPoints(vecs[0], vecs[1]);
    const line2 = m2d.lineThroughPoints(vecs[2], vecs[3]);

    const s1_x = vecs[1].x - vecs[0].x;     
    const s1_y = vecs[1].y - vecs[0].y;
    const s2_x = vecs[3].x - vecs[2].x;
    const s2_y = vecs[3].y - vecs[2].y;
    
    const s = (-s1_y * (vecs[0].x - vecs[2].x) + s1_x * (vecs[0].y - vecs[2].y)) / (-s2_x * s1_y + s1_x * s2_y);
    const t = ( s2_x * (vecs[0].y - vecs[2].y) - s2_y * (vecs[0].x - vecs[2].x)) / (-s2_x * s1_y + s1_x * s2_y);
    
    if (!isNaN(s) && !isNaN(t)) {
        // Collision detected
        return new AbsolutePointDescriptor(ip.type, ip.id, ip.gemeinde, vecs[0].x + (t * s1_x), vecs[0].y + (t * s1_y));
    }
    consola.warn("No intersection "+ip.id);
    
    return null;

/*
    const intersect = m2d.lineIntersectLine(line1, line2);
    if(!intersect.exists) {
        consola.warn("No intersection "+ip);
        return null;
    }

    return new AbsolutePointDescriptor(ip.id, intersect.x, intersect.y);*/
}

function toVec(p:PointDescriptor):m2d.IVec {
    const pos = p.getPosition();
    return m2d.vecReset(pos[0], pos[1]);
}

function calculateRelativePoint(rp:RelativePointDescriptor, points:Map<string,PointDescriptor>) {
    if( points.get(rp.p1) == null ) {
        consola.warn("Unknown Point "+rp.p1);
        return null;
    }
    if( points.get(rp.p2) == null ) {
        consola.warn("Unknown Point "+rp.p2);
        return null;
    }
    if( !points.get(rp.p1).isAbsolute() || !points.get(rp.p2).isAbsolute() ) {
        return null;
    }
    const p1 = points.get(rp.p1);
    const p2 = points.get(rp.p2);

    const d1 = adaptLength(p1, p2, rp.lengthP1P2, rp.unitP1P2);

    const line1 = m2d.lineThroughPoints(toVec(p1), toVec(p2));
    const v3 = m2d.lineGetPointAt(line1, d1);
    
    const rot = m2d.mat2dFromRotation(rp.angle * (Math.PI/180));
    const vTargetDirection = m2d.vecTransformBy(m2d.vecReset(line1.dirX, line1.dirY), rot);
    const rotLine = m2d.lineReset(v3.x, v3.y, vTargetDirection.x, vTargetDirection.y);

    const targetP = m2d.lineGetPointAt(rotLine, feetToMeter(rp.length));

    if( isNaN(targetP.x) || isNaN(targetP.y) ) {
        consola.warn("Calculation failed (NaN): "+rp.id);
        return null;
    }

    return new AbsolutePointDescriptor(rp.type, rp.id, rp.gemeinde, targetP.x, targetP.y);
}

function adaptLength(p1:PointDescriptor, p2:PointDescriptor, d:number, unit:LengthUnit):number {
    if( unit == LengthUnit.PERCENT ) {
        return m2d.vecDistance(toVec(p1), toVec(p2))*(d/100);
    }

    let mapLength:number = null;
    if( p1.id == "15-23" && p2.id == "15-22" ) {
        mapLength = 216;
    }

    let requestedLengthInMeter = unit == LengthUnit.FEET10 ? feetToMeter(d) : feet12ToMeter(d);

    if( mapLength != null ) {
        let actualLength = m2d.vecDistance(toVec(p1), toVec(p2));
        let shouldLength = feetToMeter(mapLength);
        requestedLengthInMeter = actualLength/shouldLength * requestedLengthInMeter;
    }

    return requestedLengthInMeter;
}

function feet12ToMeter(lengthFeet:number):number {
    // 1 rute = 12 fuss = 0,3138535m*12
    return lengthFeet*0.3138535;
}

function feetToMeter(lengthFeet:number):number {
    // 1 rute = 10 fuss = 3,766242m
    return lengthFeet*0.3766242;
}