import type { PointDescriptor } from '#kataster/pointDescriptors'
import type { Zeit } from '#utils/zeit';
import type * as gemeindeType from '#kataster/gemeindeType'

export class CalculatedBuilding {
    points:PointDescriptor[];
    flur:number;
    parzelle:string;
    validFrom:Zeit;
    validTill:Zeit;
    fortschreibung:string

    constructor(public gemeinde:gemeindeType.GemeindeId, flur:number, parzelle:string, public bezeichnung:string, public typ:string, public hnr:string) {
        this.flur = flur;
        this.parzelle = parzelle;
        this.points = [];
    }
}
