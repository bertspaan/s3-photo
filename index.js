#!/usr/bin/env node

var fs = require('fs');
var crypto = require('crypto');
var path = require('path');
var imagemagick = require('imagemagick-native');
var config = require(process.env.S3_PHOTO_CONFIG);
var AWS = require('aws-sdk');
var async = require('async');
var minimist = require('minimist');
var colors = require('colors');

var ext = 'jpg';

// Configure Amazon S3
AWS.config.region = config.s3.region;

if (!process.env.S3_PHOTO_CONFIG) {
  console.error('Please put path of configuration file in S3_PHOTO_CONFIG environment variable');
  process.exit(1);
}

if (!config) {
  console.error('No configuration file found on ' + process.env.S3_PHOTO_CONFIG);
  process.exit(1);
}

if (!(config.basePath && config.s3)) {
  console.error('Configuration file should contain basePath and S3 configuration');
  process.exit(1);
}

if (!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)) {
  console.error('S3 access keys expected in AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables');
  process.exit(1);
}

String.prototype.endsWith = function(suffix) {
  return this.indexOf(suffix, this.length - suffix.length) !== -1;
};

function resolvePath(str) {
  if (str.substr(0, 2) === '~/') {
    str = (process.env.HOME || process.env.HOMEPATH || process.env.HOMEDIR || process.cwd()) + str.substr(1);
  }
  return path.resolve(str);
}

var args = minimist(process.argv.slice(2))._.map(resolvePath);

if (args.length > 0) {
  async.eachSeries(args, function(arg, callback) {
    if (arg.indexOf(config.basePath) === 0) {
      fs.exists(arg, function (exists) {
        if (exists) {

          var params = {};
          var secret = getSecret(arg);

          if (secret) {
            params.secret = secret;
          }

          var stats = fs.lstatSync(arg);
          if (stats.isDirectory()) {
            console.log('Processing directory: \'' + arg + '\':');
            var files = fs.readdirSync(arg).filter(function(file) {
              return file.endsWith(ext);
            });

            var fileIndex = 0;

            async.eachSeries(files, function(file, callback) {
              if (file.endsWith(ext)) {
                console.log('  Processing file ' + (fileIndex + 1) + '/' + files.length + ': \'' + file + '\':');
                resizeAndUpload(arg + '/' + file, params, function() {
                  fileIndex += 1;
                  callback();
                });
              } else {
                callback();
              }
            }, function(err) {
              // TODO: done! do something!
              console.log('Done...');
            });
          } else {
            console.log('Processing file: \'' + arg + '\':');
            resizeAndUpload(arg, params, function() {
              // TODO: done! do something!
              console.log('Done...');
              callback();
            });
          }
        } else {
          console.error(('File or directory does not exist: \'' + arg + '\'').red);
          callback();
        }
      });
    } else {
      console.error(('File or directory not under basePath: \'' + arg + '\'').red);
      callback();
    }
  });
} else {
  console.error('Uploads image and set of thumbnails to S3. Please supply at least one command line argument: path to single photo or to directory containing photos.');
}

function resizeAndUpload(filename, params, callback) {
  var basename = path.basename(filename),
      dir = path.dirname(filename),
      s3BaseKey = dir.replace(config.basePath, '');

  if (s3BaseKey.charAt(0) == '/') {
    s3BaseKey = s3BaseKey.substring(1);
  }

  if (s3BaseKey.slice(-1) != '/') {
    s3BaseKey += '/';
  }

  if (params.secret) {
    s3BaseKey += params.secret + '/';
  }

  upload(fs.createReadStream(filename), s3BaseKey + basename, function() {
    console.log('    Upload complete:'.green + ' original size');

    async.eachSeries(config.sizes, function(size, callback) {
      var sizeStr = size.join('x'),
          s3Key = s3BaseKey + 'sizes/' + sizeStr + '/' + basename;

      var readStream = fs.createReadStream(filename).pipe(imagemagick.streams.convert({
        width: size[0],
        height: size[1],
        resizeStyle: 'aspectfit',
        quality: config.quality
      }));

      upload(readStream, s3Key, function() {
        console.log('    Upload complete:'.green + ' ' + sizeStr);
        callback()
      })
    }, function(err) {
      callback();
    });
  });
}

function upload(readStream, key, callback) {

  var s3obj = new AWS.S3({
    params: {
      Bucket: config.s3.bucket,
      Key: key,
      ContentType: 'image/jpeg'
    }
  });

  s3obj.upload({Body: readStream})
    .send(function(err, data) {
      callback(err, err == null)
    });
}

function getSecret(filename) {
  var parts = filename
      .replace(config.basePath, '')
      .split('/')
      .filter((function(part) {
        return part.length > 0;
      }));

  if (config.dirs[parts[0]]) {
    var dir = config.dirs[parts[0]];
    if (dir.secret) {
      return hash(filename, dir.salt);
    }
  }
  return false;
}

function hash(str, salt) {
  if (salt) {
    str += salt;
  }
  var hash = crypto.createHash('sha1').update(str).digest('hex');
  return hash;
}
