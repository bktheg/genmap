var chai = require('chai');
var expect = chai.expect;
var t = require('../services/map/kataster/taxierungSpec');

function resolve(str, ids) {
    return t.resolveTaxierungSpec(t.parseTaxierungSpec(str), ids);
}

describe('taxierungSpec', function () {
    it('default only', function () {
        expect(resolve('Hütung', ['clarholz', 'bm', 'kreis'])).to.equal('Hütung');
    });
    it('gemeinde override and fallback', function () {
        expect(resolve('Hütung;clarholz=Heide', ['clarholz', 'bm', 'kreis'])).to.equal('Heide');
        expect(resolve('Hütung;clarholz=Heide', ['other', 'bm', 'kreis'])).to.equal('Hütung');
    });
    it('most specific wins', function () {
        var s = 'Weide;kreis1=Wiese;bm1=Hütung;g1=Heide';
        expect(resolve(s, ['g1', 'bm1', 'kreis1'])).to.equal('Heide');
        expect(resolve(s, ['g2', 'bm1', 'kreis1'])).to.equal('Hütung');
        expect(resolve(s, ['g2', 'bm2', 'kreis1'])).to.equal('Wiese');
        expect(resolve(s, ['g2', 'bm2', 'kreis2'])).to.equal('Weide');
    });
    it('no match without default returns null', function () {
        expect(resolve('clarholz=Heide', ['other', 'bm', 'kreis'])).to.equal(null);
    });
    it('empty cell returns null', function () {
        expect(resolve('', ['a'])).to.equal(null);
    });
    it('rejects invalid entries', function () {
        expect(() => t.parseTaxierungSpec('a;b')).to.throw();
        expect(() => t.parseTaxierungSpec('=Heide')).to.throw();
        expect(() => t.parseTaxierungSpec('x=')).to.throw();
        expect(() => t.parseTaxierungSpec('x=a;x=b')).to.throw();
    });
});
