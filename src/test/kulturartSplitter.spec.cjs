var chai = require('chai');
var expect = chai.expect;
var s = require('../services/map/kataster/kulturartSplitter');

describe('kulturartSplitter', function () {
    it('splits on "u."', function () {
        expect(s.splitKulturarten('Haus u. Hofraum')).to.deep.equal(['haus', ' hofraum']);
    });
    it('splits on "und"', function () {
        expect(s.splitKulturarten('Haus und Hofraum')).to.deep.equal(s.splitKulturarten('Haus u. Hofraum'));
    });
    it('splits on "&"', function () {
        expect(s.splitKulturarten('Hofraum & Haus')).to.deep.equal(['hofraum', ' haus']);
        expect(s.splitKulturarten('Haus & Hofraum')).to.deep.equal(s.splitKulturarten('Haus u. Hofraum'));
    });
    it('keeps single Kulturart', function () {
        expect(s.splitKulturarten('Acker')).to.deep.equal(['acker']);
    });
});
