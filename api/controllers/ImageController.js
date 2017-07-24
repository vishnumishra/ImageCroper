/**
 * ImageController
 *
 * @description :: Server-side logic for managing images
 * @help        :: See http://sailsjs.org/#!/documentation/concepts/Controllers
 */
var gm = require('gm').subClass({ imageMagick: true });
var domain = require('domain').create();

var fs = require('fs');
var path = require('path');

domain.on('error', function(err) {
 	console.error(err);
});

var crop_dir = './assets/images/';

if (!fs.existsSync(crop_dir)) {
  fs.mkdirSync(crop_dir);
};


var credentials = {
  key: process.env.awsKey,
  /*'AKIAILFS4PE6H4E****',*/
  secret: process.env.awsSecret,
  /*'6lK1ndmJo*****************',*/
  bucket: process.env.awsBucketName,
  /*'image-bucket'*/
  dirname: process.env.awsdirname || '/', // Optional
};

var fileUploader = function(req, s3credential, fileParam, cb) {
	/**
	 * If redentials are not present store data locally
	 */
	if(!s3credential.key || !s3credential.secret){
		s3credential = {};
	}

	/**
	 * Domain is used to save the server creash due to any error while uploading Image
	 */
	domain.run(function safelyUpload() {
		if (fileParam && req.file(fileParam) && req.file(fileParam)._files.length > 0) {
			req.file(fileParam).upload(s3credential, cb)
		} else {
			cb({ message: 'File or FileParam not found' });
		}
	});
};

var createNewVersion = function(fileStream, fileInfo, callback) {

  var filePath = path.resolve(`${crop_dir}${fileInfo.dstSuffix}_${new Date().valueOf()}.${fileInfo.type}`);

  return fileStream.crop(fileInfo.width, fileInfo.height, fileInfo.x, fileInfo.y)
    .write(filePath, (err) => {
      callback(err, {
        [fileInfo.dstSuffix]: filePath
      });
    });
};

var getType = function(file) {
	var content_type = file._files[0].stream.headers['content-type'];
	if (content_type.match('jpg')) return 'jpg';
	if (content_type.match('png')) return 'png';
	if (content_type.match('jpeg')) return 'jpeg';
	return null;
};


module.exports = {

	get: function(req,res){
		var obj = req.allParams();
		obj.select = ['main', 'horizontal', 'vertical', 'hsm', 'gallery'];
		Image.find(obj, (err,images)=>{
			console.log(images);
			if (err) return res.serverError(err);
			return res.view('image', {
			    Images: images.map((img)=>{
			    	for(let key in img){
			    		if(typeof img[key]=== 'string' && !((img[key]).match(/http|https/))){
			    			img[key] = path.relative('./assets',img[key]);
			    		};
			    	};
			    	return img;
			    })
			});
		})
	},
	add:function(req, res){
		res.view('image_add');
	},
	crop: function(req, res) {
		var uploadSize = { height: 1024, width: 1024 };

		/**
		 * VERSIONS are list of image type we need to create. It can be store in DB (Size Model).
		 */
		
		var VERSIONS = [
		  { width: 1024, height: 1024, x: 0, y: 0, dstSuffix: "main" },
		  { width: 755, height: 450, x: 0, y: 0, dstSuffix: "horizontal" },
		  { width: 365, height: 450, x: 0, y: 0, dstSuffix: "vertical" },
		  { width: 365, height: 212, x: 0, y: 0, dstSuffix: "hsm" },
		  { width: 380, height: 380, x: 0, y: 0, dstSuffix: "gallery" }
		];

		/**
		 * Get File type of the Uploaded file
		 */
		var type = getType(req.file('image'));


		fileUploader(req, credentials, 'image', (err, uploadedFiles) => {
			if (err) {
				return res.serverError(err);
			}
			var filePath = uploadedFiles[0].fd;
			if (!filePath) {
			return res.serverError({ message: "Unable to upload the Image" });
			};

			var fileStream = gm(filePath);

			fileStream.size((err, size) => {
				if (err) return res.badRequest(err);
				if (size.width != uploadSize.width || size.height != uploadSize.height) {
				  return res.badRequest({ message: `Please check the size of the Imaage. It should be ${uploadSize.width} x ${uploadSize.height}.` });
				};
			    /**
			     * Paraller map to create multiple Images
			     */
			    async.map(VERSIONS, (file, cb) => {
			          file.type = type;
			          createNewVersion(fileStream, file, cb);

			    }, function(err, results) {

					if (err) return res.serverError(err);

					var ImageData = {};
					results.forEach((url) => {
						let key = Object.keys(url)[0];
						ImageData[key] = url[key];
					});

			      	Image.create(ImageData).then((data) => {
			        	res.view('image');
			      	})
			      	.catch(res.serverError);
			    });
			});
		});
	}
};
