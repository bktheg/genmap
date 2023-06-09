import * as XLSX from 'xlsx'
import * as fs from 'fs'

export function loadExcelsInPath(path:string, loadCallback:(path:string,file:string) => void):void {
    const result = []
    const basePaths = [path];
    let basePath:string = undefined;
    while( (basePath = basePaths.shift()) ) {
        for( const file of fs.readdirSync(basePath)) {
            if( fs.lstatSync(`${basePath}/${file}`).isDirectory() ) {
                basePaths.push(`${basePath}/${file}`);
                continue;
            }
            if( !file.endsWith(".xlsx") || file.startsWith("~") || file.startsWith('__') ) {
                continue;
            }
            
            loadCallback(basePath, file)
        }
    }
}

export class TableLoader {
    private colMap:Map<string,string> = new Map();

    constructor(private sheet:XLSX.WorkSheet) {
        for( let col='A'; col <= 'Z'; col=String.fromCharCode(col.charCodeAt(0) + 1) ) {
            const header = this.sheet[col+'1'];
            if( header ) {
                this.colMap.set(header.v.toString().toLowerCase(), col);
            }
            else {
                break;
            }
        }
    }

    readString(colName:string, row:number):string {
        const col = this.colMap.get(colName.toLowerCase());
        if( !col ) {
            throw new Error("Unknown column name "+colName);
        }
        const cell = this.sheet[col+row];
        if( cell ) {
            return cell.v.toString();
        }
        return '';
    }

    readOptionalString(colName:string, row:number):string {
        const col = this.colMap.get(colName.toLowerCase());
        if( !col ) {
            return ''
        }
        const cell = this.sheet[col+row];
        if( cell ) {
            return cell.v.toString();
        }
        return '';
    }
    
    readNumber(colName:string, row:number):number {
        const col = this.colMap.get(colName.toLowerCase());
        if( !col ) {
            throw new Error("Unknown column name "+colName);
        }
        const cell = this.sheet[col+row];
        if( cell ) {
            return cell.v;
        }
        return null;
    }

    readOptionalNumber(colName:string, row:number):number {
        const col = this.colMap.get(colName.toLowerCase());
        if( !col ) {
            return null
        }
        const cell = this.sheet[col+row];
        if( cell ) {
            return cell.v;
        }
        return null;
    }

    hasColumn(colName:string):boolean {
        return this.colMap.has(colName.toLowerCase());
    }
}
