module.exports = function(grunt) {
    var nodeBin = __dirname + '/node_modules/.bin';

    grunt.initConfig({

        exec: {
            jasmineTests: {
                cmd: nodeBin + '/jasmine-node ./*.spec.js'
            }
        }
    });

    grunt.loadNpmTasks('grunt-exec');

    grunt.registerTask('test', 'Runs jasmine tests', [
        'exec:jasmineTests'
    ]);
};
