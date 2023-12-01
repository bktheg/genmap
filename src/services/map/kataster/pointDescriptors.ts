import { GemeindeId } from "#kataster/gemeindeType";

export enum PointType {
    NET,
    NET_MERIDIAN,
    PROPERTY,
    BUILDING,
    HELPER
}

export interface PointDescriptor {
    id:string;
    gemeinde:GemeindeId;
    type:PointType;
    isAbsolute():boolean;
    getPosition():number[];
}

export class MultiWayPointDescriptor implements PointDescriptor {
    descriptors:PointDescriptor[];
    resolved:PointDescriptor = null;
    gemeinde:GemeindeId;
    id:string;
    type:PointType;
    
    constructor(descriptor:PointDescriptor, descriptor2:PointDescriptor) {
        if( descriptor.id != descriptor2.id || descriptor.type != descriptor2.type ) {
            throw new Error("Not the same point "+descriptor2.id);
        }
        this.id = descriptor.id;
        this.gemeinde = descriptor.gemeinde;
        this.type = descriptor.type;
        this.descriptors = [descriptor, descriptor2];
    }

    isAbsolute(): boolean {
        return this.resolved != null;
    }

    getPosition(): number[] {
        return this.resolved != null ? this.resolved.getPosition() : null;
    }

    resolve(calculated:PointDescriptor) {
        if( !calculated.isAbsolute() ) {
            throw new Error("Absolute point expected");
        }
        this.resolved = calculated;
    }

    add(p:PointDescriptor) {
        this.descriptors.push(p);
    }
}

export class AbsolutePointDescriptor implements PointDescriptor {
    id:string;
    gemeinde:GemeindeId;
    type:PointType;
    x:number;
    y:number;

    constructor(type:PointType, id:string, gemeinde:GemeindeId, x:number, y:number) {
        this.type = type;
        this.id = id;
        this.x = x;
        this.y = y;
        this.gemeinde = gemeinde;
    }

    isAbsolute():boolean {
        return true;
    }

    getPosition():number[] {
        return [this.x, this.y];
    }
}

export class LocalCoordinateSystem {
    absoluteX:number=0
    absoluteY:number=0

    constructor(
        public gemeinde:GemeindeId,
        public flur:number
    ) {}

    isSolved():boolean {
        return this.absoluteX != 0 && this.absoluteY != 0;
    }

    solve(x:number, y:number) {
        if(this.isSolved()) {
            throw new Error('Coordinate System already solved')
        }
        this.absoluteX = x
        this.absoluteY = y
    }
}

export class LocalAbsolutePointDescriptor implements PointDescriptor {
    id:string;
    gemeinde:GemeindeId;
    type:PointType;

    constructor(type:PointType, id:string, gemeinde:GemeindeId, public x:number, public y:number, public localCoordSys:LocalCoordinateSystem) {
        this.type = type;
        this.id = id;
        this.x = x;
        this.y = y;
        this.gemeinde = gemeinde;
    }

    isAbsolute():boolean {
        return this.localCoordSys.isSolved();
    }

    getPosition():number[] {
        if( !this.isAbsolute() ) {
            return null
        }
        return [this.x+this.localCoordSys.absoluteX, this.y+this.localCoordSys.absoluteY];
    }
}

export enum LengthUnit {
    // 10 Fuss = 1 Rute = 0,3766242m = Preuss. Verm. Fuss
    FEET10,
    // 12 Fuss = 1 Rute = 0,3138535m = Preuss. Fuss
    FEET12,
    PERCENT
}

export class RelativePointDescriptor implements PointDescriptor {
    type:PointType;
    gemeinde:GemeindeId;
    id:string;
    p1:string;
    p2:string;
    lengthP1P2:number;
    unitP1P2:LengthUnit = LengthUnit.FEET10;
    angle:number;
    length:number;

    constructor(type:PointType, id:string, gemeinde:GemeindeId, p1:string,p2:string,lengthP1P2:number,unitP1P2:LengthUnit,angle:number,length:number) {
        this.type = type;
        this.id=id;
        this.p1=p1;
        this.p2=p2;
        this.lengthP1P2=lengthP1P2;
        this.unitP1P2=unitP1P2;
        this.angle=angle;
        this.length=length;
        this.gemeinde = gemeinde;
    }

    isAbsolute():boolean {
        return false;
    }

    getPosition():number[] {
        return null;
    }
}

export class AveragePointDescriptor implements PointDescriptor {
    type:PointType;
    id:string;
    gemeinde:GemeindeId;
    p:string[];
    
    constructor(type:PointType, id:string, gemeinde:GemeindeId, p:Array<string>) {
        this.type = type;
        this.id=id;
        this.p = p;
        this.gemeinde = gemeinde;
    }

    isAbsolute():boolean {
        return false;
    }

    getPosition():number[] {
        return null;
    }
}

// ["INTERSECT", "REF", "REF", "REF", "REF"]
export class IntersectPointDescriptor implements PointDescriptor {
    type:PointType;
    id:string;
    gemeinde:GemeindeId;
    p:string[];
    
    constructor(type:PointType,id:string,gemeinde:GemeindeId, p:Array<string>) {
        this.type = type;
        this.id = id;
        this.p = p;
        this.gemeinde = gemeinde;
    }

    isAbsolute():boolean {
        return false;
    }

    getPosition():number[] {
        return null;
    }
}

export class AliasPointDescriptor implements PointDescriptor {
    private resolved:PointDescriptor;

    constructor(public type:PointType, public id:string, public gemeinde:GemeindeId, public p:string) {}

    getReferencedPointId() {
        return this.p;
    }

    isAbsolute():boolean {
        return this.resolved != null;
    }

    resolve(p:PointDescriptor) {
        if( !p.isAbsolute() ) {
            throw new Error("Absolute point expected");
        }
        this.resolved = p;
    }

    getPosition():number[] {
        return this.resolved != null ? this.resolved.getPosition() : null
    }
}