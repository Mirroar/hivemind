module.exports = function (grunt) {
	grunt.loadNpmTasks('grunt-screeps');

	grunt.registerTask('default', ['screeps']);

	grunt.initConfig({
		screeps: {
			options: {
				// Add your screeps account information here.
				email: 'YOUR SCREEPS EMAIL',
				token: 'YOUR SCREEPS API TOKEN',

				// Uncomment the following line if you want the code to be deployed to the season server instead of the main world.
				// server: 'season',

				branch: 'default',
				ptr: false,
			},
			dist: {
				src: ['dist/*.js', 'dist/*.js.map'],
			},
		},
	});
};
