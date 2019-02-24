//
// Common test functions and infrastructure, defined at global scope
//

require('./test-infra');

declare function callSuite(fn: any, cases: {it: any, i: any, o: any}[]): any;



//
// Load the tests themselves
//

require('./util.test');
require('./model.test');
require('./stored-object.test');
