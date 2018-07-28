// Test infrastructure
import {expect} from 'chai';

//
// Common test functions and infrastructure, defined at global scope
//

global.expect = expect;

global.callSuite = (fn, cases) => {
    // desc: text description of the function to test
    // fn: the function to test
    // cases: [ {i /* arguments */, o /* return value */, e /* exception */} ]

    return function() {
        for (let c of cases) {
            it(c.it ? c.it : JSON.stringify(c), function() {
                try {
                    let res = fn(...c.i);
                    if (! c.hasOwnProperty('o')) throw 'Function did not throw';
                    expect(res).to.eql(c.o);
                } catch (e) {
                    if (! c.hasOwnProperty('e')) throw e;
                    expect(e).to.eql(c.e);
                }
            });
        }
    };
};

global.browser = {
    runtime: {
        getPlatformInfo: () => new Promise((resolve, reject) => {
            resolve({os: 'unknown', arch: 'unknown', nacl_arch: 'unknown'});
        }),
    },
};


//
// Load the tests themselves
//

require('./util.test');
