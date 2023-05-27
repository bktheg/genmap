import {JsonParzelle,JsonArea,JsonBuilding, AreaTyp} from '#kataster/parzellenReader';
import * as gemeindeType from '#kataster/gemeindeType'
import { consola } from 'consola';

export class Parzelle {
    area: JsonArea[] = [];
    building: JsonBuilding[] = [];
    typ:AreaTyp;

    constructor(public gemeinde:gemeindeType.GemeindeId, public flur:number, public nr:string) {}

    id():string {
        return this.gemeinde.getId()+"-"+this.flur+"-"+this.nr;
    }

    export():JsonParzelle {
        return {
            area:this.area,
            building:this.building,
            help:null,
            typ:this.typ
        }
    }

    generateCoordAlias(coord:number[]):any[] {
        let idx = 0;
        for( const a of this.area ) {
            for( const r of a.points ) {
                for( const p of r ) {
                    idx++;
                    if( p[0] != "ABS" ) {
                        continue;
                    }

                    if( Math.abs(p[1]-coord[0]) < 0.2 && Math.abs(p[2]-coord[1]) < 0.2 ) {
                        return ["REF", "A"+idx];
                    }
                }
            }
        }
        return null;
    }
}

export class ParzellenRegistry {
    parzellen:Map<string,Parzelle> = new Map();
    
    getOrCreate(gemeinde:gemeindeType.GemeindeId, flur:(number|string), nr:string):Parzelle {
        const nrString = !nr || nr == "?" ? "none" : nr;
        const flurNr = typeof flur === 'string' ? parseInt(flur) : flur;
        let id = gemeinde.getId()+'-'+flur+'-'+nrString;
        if( !this.parzellen.has(id) ) {
            this.parzellen.set(id, new Parzelle(gemeinde, flurNr, nrString));
        }
        return this.parzellen.get(id);
    }
    
    values() {
        return this.parzellen.values();
    }
}