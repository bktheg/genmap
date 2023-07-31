import XLSX from 'xlsx'
import {PointDescriptor, AbsolutePointDescriptor, RelativePointDescriptor, LengthUnit, MultiWayPointDescriptor, PointType} from '#kataster/pointDescriptors'
import * as math2d from 'math2d';
import * as gemeindeType from '#kataster/gemeindeType';
import * as XslxUtils from '#utils/xslxUtils'
import { consola } from 'consola';

const katasterPath = process.env.KATASTER_PATH

function readCell(sheet:XLSX.WorkSheet, col:string, row:number) {
    const cell = sheet[col+row];
    if( cell ) {
        return cell.v == null ? '' : cell.v.toString();
    }
    return '';
}

function toNumber(text:string):number {
    if( text == null || text == '' ) {
        return null;
    }
    return parseFloat(text.toString().replace(',', '.'));
}

function toCoord(sign:string, value:string, settings:FlurNetSetting):number {
    if( value == null || value == '' || settings.ignoreCoordinates ) {
        return null;
    }
    return ('-' == sign ? -1 : 1)*toNumber(value)*(settings.flip ? -1 : 1);
}

export class NetPoints {
    constructor(public points:Map<string,PointDescriptor>, public flure:Map<string,PointDescriptor[]>) {}
}

class StationDescriptor {
    constructor(public id:string, public angle:number, public distance:number, public coordX:number, public coordY:number) {}
}
 
 
function localToProj(localX:number, localY:number, coordinateSystem:gemeindeType.CoordinateSystem):number[] {
    const mat = math2d.mat2dFromRotation(coordinateSystem.rotation * (Math.PI/180));
    const scale = 3.766242;
    const vec = math2d.vecReset(localX*scale, localY*scale)
    const rotated = math2d.vecTransformBy(vec, mat);

    const origin = coordinateSystem.origin;

    return [origin[0]+rotated.x, origin[1]+rotated.y];
}


export async function readNetPoints():Promise<NetPoints> {
    const result = new NetPoints(new Map(), new Map());

    XslxUtils.loadExcelsInPath(`${katasterPath}/net`, (path,file) => {
        let gemeinde = file.substring(0, file.indexOf("."));
        const gemeindeParts = gemeinde.split('-');
        let gemeindeId:gemeindeType.GemeindeId;
        try {
            gemeindeId = gemeindeType.forId(gemeindeParts[gemeindeParts.length-1])
        }
        catch( ex ) {
           throw new Error("Konnte Netz-Datei keiner Gemeinde zuordnen. Bitte Dateinamen überprüfen: "+file);
        }

        try {
            readNetPointsFromExcel(result, path+"/"+file, gemeindeId);
        }
        catch( ex ) {
            consola.error("Konnte Netzdatei", path+"/"+file, "nicht (vollständig) laden.", ex)
        }
    })

    consola.success(`${result.points.size} Vermessungspunkte gelesen`);

    for( const kreis of gemeindeType.KREISE ) {
        if( kreis.vermessungsraster ) {
            createMeridianNetFor(result, 'kreis-'+kreis.getId(), kreis.getCoordinateSystem(), kreis.vermessungsraster);
        }
    }

    for( const bmstr of gemeindeType.BUERGERMEISTEREIEN ) {
        if( bmstr.vermessungsraster ) {
            createMeridianNetFor(result, 'buergermeisterei-'+bmstr.getId(), bmstr.getCoordinateSystem(), bmstr.vermessungsraster);
        }
    }

    for( const gemeinde of gemeindeType.GEMEINDEN ) {
        if( gemeinde.vermessungsraster ) {
            createMeridianNetFor(result, 'gemeinde-'+gemeinde.getId(), gemeinde.getCoordinateSystem(), gemeinde.vermessungsraster);
        }
    }

    return result;
}

function createMeridianNetFor(result:NetPoints, netId:string, coordinateSystem:gemeindeType.CoordinateSystem, steps:number) {
    for( let i=-steps; i <=steps; i++ ) {
        for( let j=-steps; j<=steps; j++ ) {
            const pos = localToProj(i*100, j*100, coordinateSystem);
            const id = netId+"_"+(i*100)+"_"+(j*100);
            result.points.set(id, new AbsolutePointDescriptor(PointType.NET_MERIDIAN, id, null, pos[0], pos[1]));
        }
    }
}

class FlurId {
    private gemeindeId:gemeindeType.GemeindeId;
    private flurNr:number;
    private name:string;
    private polygon:string;

    constructor(gemeindeId:gemeindeType.GemeindeId, station:string) {
        this.gemeindeId = gemeindeId;
        if( isNaN(+station) ) {
            this.flurNr = this.flurToNumber(station);
        } 
        else {
            this.flurNr = parseInt(station);
        }
        if( station.indexOf(' gnt. ') > -1 ) {
            this.name = station.split(' gnt. ')[1];
        }
        else if( station.indexOf(' Polygon ' ) > -1 ) {
            this.polygon = station.split(' Polygon ')[1];
        }
        else {
            this.name = null;
            this.polygon = null;
        }
    }

    flurToNumber(flur:string):number {
        const parts = flur.split(' ');
        return romanToInt(parts[1]);
    }

    asString():string {
        const gemeindeStr = this.gemeindeId.getId();
        return (gemeindeStr ? gemeindeStr+"-" : "")
            + this.flurNr
            + (this.polygon != null ? '_'+this.polygon : '')
            + (this.name != null ? ' gnt. '+this.name : '');
    }

    getFlurNr():number {
        return this.flurNr;
    }
}

class FlurNetSetting {
    constructor(public ignoreCoordinates:boolean=false, public flip:boolean=false) {}
}

function readFlurSettings(sheet:XslxUtils.TableLoader, gemeinde:gemeindeType.GemeindeId):Map<number,FlurNetSetting> {
    const result = new Map<number,FlurNetSetting>()
    for( const flur of gemeinde.getFlure() ) {
        result.set(flur.getId(), new FlurNetSetting());
    }

    if( sheet.hasColumn('Flur') ) {
        let i = 1
        let skipped = 0
        while(true) {
            i++
            const flur = sheet.readNumber('Flur', i)
            if( !flur ) {
                if( skipped++ > 5 ) {
                    break
                }
                continue
            }
            if( !result.has(flur) ) {
                consola.warn("Unbekannte Flur", flur, "in den Netz-Einstellungen von Gemeinde", gemeinde.getId())
                continue
            }
            result.get(flur).ignoreCoordinates = sheet.readOptionalBoolean('Ignoriere Koordinaten', i, false)
            result.get(flur).flip = sheet.readOptionalBoolean('Spiegeln', i, false)
        }
    }
    return result
}

function readNetPointsFromExcel(result:NetPoints, file:string, gemeindeId:gemeindeType.GemeindeId):NetPoints {
    const workbook = XLSX.readFile(file);
    let sheet = workbook.Sheets['Rechnung goniom. Koord.'];
    if( !sheet ) {
        sheet = workbook.Sheets[workbook.SheetNames[0]];
    }

    const flurSettings = readFlurSettings(new XslxUtils.TableLoader(workbook.Sheets['Einstellungen']), gemeindeId)

    let flur:FlurId = null;
    let i = 3; // Skip header
    let skipped = 0;
    let list:StationDescriptor[] = []
    let subpolygon:boolean = false;
    let settings = new FlurNetSetting()
    while(true) {
        i++;
        const station = readCell(sheet, 'B', i);
        const wGrad = readCell(sheet, 'C', i);
        const wM = readCell(sheet, 'D', i);
        const wS = readCell(sheet, 'E', i);
        const distance = readCell(sheet, 'I', i);
        let signX = readCell(sheet, 'AA', i);
        let x = readCell(sheet, 'AB', i);
        let signY = readCell(sheet, 'AD', i);
        let y = readCell(sheet, 'AE', i);
        
        if( station == '' ) {
            if( skipped++ > 5 ) {
                break;
            }
            continue;
        }
        skipped = 0;

        if( !signX && !signY ) {
            // Korrigierte Koordinaten liegen nicht vor -> Zusammengestellte Koordinaten probieren
            signX = readCell(sheet, 'U', i);
            x = readCell(sheet, 'V', i);
            signY = readCell(sheet, 'X', i);
            y = readCell(sheet, 'Y', i);    
        }

        if( wGrad == '' && station.toLowerCase().startsWith('flur ') ) {
            calculatePointDescrList(list, result, subpolygon, flur, gemeindeId, settings);
            list = [];
            flur = new FlurId(gemeindeId, station);
            settings = flurSettings.get(flur.getFlurNr())
            if( settings == null ) {
                consola.warn("Unbekannte Flur", flur.getFlurNr(), "in Netzdatei für Gemeinde", gemeindeId.getId(), "angegeben. Station: "+station)
                settings = new FlurNetSetting()
            }
            subpolygon = false;
        }
        else if( wGrad == '' && station.toLowerCase() == 'koordinaten' ) {
            calculatePointDescrList(list, result, subpolygon, flur, gemeindeId, flurSettings.get(flur?.getFlurNr()));
            list = [];
            flur = null;
            settings = new FlurNetSetting()
            subpolygon = false;
        }
        else if( wGrad == '' && station.toLowerCase().startsWith('punkte zwischen') ) {
            calculatePointDescrList(list, result, subpolygon, flur, gemeindeId, flurSettings.get(flur?.getFlurNr()));
            list = [];
            subpolygon = true;
        }
        else if (wGrad == '' && station.toLowerCase().startsWith('betrachtungen der coordinaten ')) {
            calculatePointDescrList(list, result, subpolygon, flur, gemeindeId, flurSettings.get(flur?.getFlurNr()));
            list = [];
            subpolygon = true;
        }
        else {
            list.push(new StationDescriptor(stationToId(gemeindeId,flur,station), 
                wGrad != '' ? toNumber(wGrad)+toNumber(wM)/100+toNumber(wS)/10000 : null, 
                toNumber(distance),
                toCoord(signX, x, settings),
                toCoord(signY, y, settings)));
        }
    }
    
    calculatePointDescrList(list, result, subpolygon, flur, gemeindeId, flurSettings.get(flur?.getFlurNr()));

    return result;
}

function calculatePointDescrList(stationen:StationDescriptor[], netPoints:NetPoints, subpolygon:boolean, flur:FlurId, gemeindeId:gemeindeType.GemeindeId, flurSettings:FlurNetSetting):void {
    if( stationen.length < 2 ) {
        return;
    }

    // Handle subpolygon in reverse order. Subpolygons are not closed. 
    // The data only got enough info to connect to the main poly at the end
    if( subpolygon ) {
        stationen = stationen.reverse();
    }

    if( stationen[0].id == stationen[stationen.length-1].id ) {
        if( stationen[0].distance == null ) {
            stationen[0].distance = stationen[stationen.length-1].distance;
        }
        if( stationen[0].angle == null ) {
            stationen[0].angle = stationen[stationen.length-1].angle;
        }
        stationen.splice(stationen.length-1, 1);
    }

    const result:PointDescriptor[] = [];

    for( let i=subpolygon ? 1 : 0; i < stationen.length; i++ ) {
        const current = stationen[i];
        const prev = i > 0 ? stationen[i-1] : stationen[stationen.length-1];
        const next = i < stationen.length-1 ? stationen[i+1] : stationen[0];

        if( next.coordX != null && next.coordY != null ) {
            const proj = localToProj(next.coordX, next.coordY, gemeindeId.getCoordinateSystem());
            result.push(new AbsolutePointDescriptor(PointType.NET, next.id, null, proj[0], proj[1]));
            continue;
        }
        
        const distance = subpolygon ? next.distance : current.distance;
        
        if( distance != null && current.angle != null ) {
            const angle = 180-current.angle/400*360;
            result.push(new RelativePointDescriptor(
                PointType.NET,
                next.id, 
                null,
                prev.id, 
                current.id, 
                100, LengthUnit.PERCENT, 
                subpolygon || flurSettings.flip ? angle : -angle, 
                distance*10));
        }
    }

    if( !subpolygon && flur != null ) {
        const id = flur.asString();
        const data = [...result, result[0]];
        if( !netPoints.flure.has(id) ) {
            netPoints.flure.set(id, data);
        }
        else {
            let idx = 2;
            while(netPoints.flure.has(id+"_"+idx) ) {
                idx++;
            }
            netPoints.flure.set(id+"_"+idx, data);
        }
    }

    for( const e of result ) {
        if( !netPoints.points.has(e.id) ) {
            netPoints.points.set(e.id, e);
        }
        else if( netPoints.points.get(e.id) instanceof MultiWayPointDescriptor ) {
            (<MultiWayPointDescriptor>netPoints.points.get(e.id)).add(e);
        }
        else {
            netPoints.points.set(e.id, new MultiWayPointDescriptor(e, netPoints.points.get(e.id)));
        }
    }
}

function stationToId(gemeindeId:gemeindeType.GemeindeId,flur:FlurId,station:string):string {
    if( station.startsWith('#') ) {
        let part = station.substr(1).trim();
        if( part.indexOf('(') > -1 ) {
            part = part.substr(0, part.indexOf('('));
        }
        else if( /^[0-9]+[_\-A-Za-z] [A-Za-z]+$/.test(part) ) {
            const subparts = part.split(" ");
            return "0-"+expandGemeindeIdStr(subparts[1]).getParent().getName()+"-"+subparts[0];
        }
        return "0-"+gemeindeId.getParent().getName()+"-"+part.trim();
    }

    const parts = station.split(' ');
    let explicitFlur = false;

    if( parts.length > 1 && /[XVI]+/.test(parts[1]) ) {
        // Nr FlurNr
        parts[1] = romanToInt(parts[1]).toPrecision();
        explicitFlur = true;
    }
    else if( parts.length == 2 ) {
        // Nr GemeindeId
        parts.push(parts[1]);
        parts[1] = "1";
    }
    else if( parts.length == 1 ) {
        // Nr
        parts.push(flur.getFlurNr().toString());
    
    }

    try {
        const gemeinde = parts.length > 2 ? expandGemeindeIdStr(parts[2]) : gemeindeId;
        const gid = gemeinde.getId();

        return (gid+'-')+(gemeinde.getParent().isPointPerGemeinde() && !explicitFlur ? "" : parts[1]+'-')+parts[0];
    }
    catch(ex) {
        throw new Error("Failed to generate net point id for "+gemeindeId.getId()+" flur "+flur.getFlurNr()+" point "+station+": "+ex)
    }
}

function expandGemeindeIdStr(gemeindeIdStr:string):gemeindeType.GemeindeId {
    let str = gemeindeIdStr.toLowerCase();
    try {
        return gemeindeType.forId(str);
    }
    catch( ex ) {
        return gemeindeType.forName(str);
    }
}

const romanMap = new Map([
    ['I', 1],
    ['V', 5],
    ['X', 10]
  ]);
  
  function romanToInt(string:string):number {
    let result = 0, current, previous = 0;
    for (const char of string.split("").reverse()) {
      current = romanMap.get(char);
      if (current >= previous) {
        result += current;
      } else {
        result -= current;
      }
      previous = current;
    }
    return result;
  }
  