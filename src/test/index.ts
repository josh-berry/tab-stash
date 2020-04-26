//
// Common mocks
//

import './mock/browser-runtime';
import './mock/browser-storage';
import './mock/indexeddb';


//
// Load the tests themselves
//

require('./util');
require('./model');
require('./stored-object');
require('./cache-client');
require('./cache-service');
require('./tasks/import');
