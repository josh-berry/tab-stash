if (! (<any>globalThis).browser) (<any>globalThis).browser = {};

(<any>globalThis).browser.runtime = {
    getPlatformInfo: () => new Promise((resolve, reject) => {
        resolve({os: 'unknown', arch: 'unknown'});
    }),
};
