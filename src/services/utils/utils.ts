export function compareTextWithAbbreviations(typed1:string, typed2:string):boolean {
    const t1 = typed1.toLowerCase().split(" ");
    const t2 = typed2.toLowerCase().split(" ");
    if( t1.length != t2.length ) {
        return false;
    }

    let i1 = 0;
    let i2 = 0;
    while( i1 < t1.length && i2 < t2.length ) {
        const w1 = t1[i1];
        const w2 = t2[i2];

        if( w1 == w2 ) {
            i1++;
            i2++;
            continue;
        }
        const wildcard1 = w1.endsWith(".");
        const wildcard2 = w2.endsWith(".");
        if( wildcard1 && wildcard2 ) {
            const wr1 = w1.substr(0, w1.length-1);
            const wr2 = w2.substr(0, w2.length-1);
            if( (wr1.length < wr2.length && wr2.startsWith(wr1)) ||
                (wr2.length < wr1.length) && wr1.startsWith(wr2) ) {
                i1++;
                i2++;
                continue;
            }
            return false;
        }
        if( wildcard1 ) {
            const wr1 = w1.substr(0, w1.length-1);
            const wr2 = w2;
            if( wr2.startsWith(wr1) ) {
                i1++;
                i2++;
                continue;
            }
            return false;
        }
        if( wildcard2 ) {
            const wr1 = w1;
            const wr2 = w2.substr(0, w2.length-1);
            if( wr1.startsWith(wr2) ) {
                i1++;
                i2++;
                continue;
            }
            return false;
        }
        return false;
    }

    return true;
}