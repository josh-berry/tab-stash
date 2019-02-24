import {expect} from 'chai';

function callSuite(fn: any, cases: {it: any, i: any, o: any}[]): any {
    // desc: text description of the function to test
    // fn: the function to test
    // cases: [ {i /* arguments */, o /* return value */, e /* exception */} ]

    return function() {
        for (let c of cases) {
            it(c.it ? c.it : JSON.stringify(c), function() {
                let res = fn(...c.i);
                expect(res).to.eql(c.o);
            });
        }
    };
};
(global as any).callSuite = callSuite;

(global as any).browser = {
    runtime: {
        getPlatformInfo: () => new Promise((resolve, reject) => {
            resolve({os: 'unknown', arch: 'unknown'});
        }),
    },
};
