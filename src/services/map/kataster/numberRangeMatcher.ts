export class NumberRangeMatcher {
    private rangeList:string[];

    constructor(ranges:string, private excludeUpper:boolean=false) {
        this.rangeList = ranges.split(',').map(p => p.trim()).filter(p => p.length > 0);
    }

    public matches(parzelle:string):boolean {
        for( const pattern of this.rangeList ) {
            if( pattern == parzelle ) {
                return true;
            }
            if( pattern.indexOf('-') > -1 ) {
                const parts = pattern.split('-');
                if( this.excludeUpper ) {
                    if( this.compareParzelleNr(parzelle, parts[0]) >= 0 && this.compareParzelleNr(parzelle, parts[1]) < 0 ) {
                        return true;
                    }
                }
                else if( this.compareParzelleNr(parzelle, parts[0]) >= 0 && this.compareParzelleNr(parzelle, parts[1]) <= 0 ) {
                    return true;
                }
            }
        }
        return false;
    }

    private compareParzelleNr(a:string, b:string):number {
        const aNr = parseInt(a)
        const bNr = parseInt(b)
        const diff = aNr-bNr
        if( diff != 0 ) {
            return diff
        }
        return a.localeCompare(b)
    }

    public addPattern(pattern:string) {
        this.rangeList.push(pattern);
    }
}