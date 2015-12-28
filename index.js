#!/usr/bin/env node

var argv = require('minimist')(process.argv.slice(2));

var fs = require('fs');
var util = require('util');
var crypto = require('crypto');
var path = require('path');
var yaml = require('js-yaml');
var AWS = require('aws-sdk');
var async = require('async');
var chalk = require('chalk');
var unorm = require('unorm');

function die(message) {
  console.error(message);
  process.exit(-1);
}

function indexOfDir(basePaths, f) {
  var index = -1;
  basePaths.forEach(function(p, i) {
    if (f.startsWith(p)) {
      index = i;
    }
  });
  return index;
}

function normalize(str) {
  var combining = /[\u0300-\u036F]/g;
  str = str.toLowerCase();
  str = unorm.nfkd(str)
    .replace(combining, '')
    .replace(/[\?!]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+&+-+/g, '+')
    .replace(/['"]+/g, '')
    .replace(/-+/g, '-')
    .replace(/\./g, '');

  return str;
}

try {
  var gm = require('gm');
} catch (e) {
  die('Imagemagick not installed - please install Imagemagick');
}

var filename = argv.config || process.env.S3_PHOTO_CONFIG;

if (!filename) {
  die('Please specify location of your user configuration in environment variable `S3_PHOTO_CONFIG`, or use the `--config` command line option');
}

try {
  var config = yaml.safeLoad(fs.readFileSync(filename, 'utf8'));
} catch (e) {
  die(util.format('Can\'t open configuration file `%s`', filename));
}

var ext = 'jpg';

// Configure Amazon S3
AWS.config.region = config.s3.region;

// TODO: also read access keys from config, if present

if (!(config.s3)) {
  die('Configuration file should contain S3 configuration');
}

function resolvePath(str) {
  if (str.substr(0, 2) === '~/') {
    str = (process.env.HOME || process.env.HOMEPATH || process.env.HOMEDIR || process.cwd()) + str.substr(1);
  }
  return path.resolve(str);
}

var paths = argv._.map(resolvePath);

if (paths.length > 0) {
  var basePaths = config.dirs.map(function(d) {
    return d.basePath;
  });

  async.eachSeries(paths, function(p, callback) {
    var i = indexOfDir(basePaths, p);
    if (i > -1) {

      fs.exists(p, function (exists) {
        if (exists) {
          var params = {
            config: config.dirs[i]
          };

          var secret = getSecret(p, params.config);

          if (secret) {
            params.secret = secret;
          }

          var stats = fs.lstatSync(p);
          if (stats.isDirectory()) {
            console.log(util.format('Processing directory %s:', chalk.underline(p)));
            var files = fs.readdirSync(p).filter(function(file) {
              return file.toLowerCase().endsWith(ext);
            });

            var s3Key;
            var fileIndex = 0;
            async.eachSeries(files, function(file, callback) {
              console.log(util.format('  Processing file %s: %s'), chalk.underline(file), chalk.gray('(' + (fileIndex + 1) + '/' + files.length + ')'));
              resizeAndUpload(p + '/' + file, params, function(err, s3BaseKey) {
                fileIndex += 1;
                s3Key = s3BaseKey;

                callback(err);
              });
            }, function done(err) {
              console.log(chalk.blue('Finished directory, written to S3 key:'), s3Key, '\n');
              callback();
            });
          } else {
            console.log(util.format('Processing file %s:', chalk.underline(p)));
            resizeAndUpload(p, params, function(err, s3BaseKey) {
              console.log(chalk.blue('Finished file, written to S3 key:'), s3BaseKey, '\n');

              callback();
            });
          }
        } else {
          console.error(chalk.red('File or directory does not exist ') + chalk.underline(p));
          callback();
        }
      });
    } else {
      console.error(chalk.red('No configuration found for file or directory ') + chalk.underline(p));
      callback();
    }
  }, function done() {
    console.log('Done...');
  });

} else {
  console.error('Uploads image and set of thumbnails to S3. Please supply at least one command line argument: path to single photo or to directory containing photos.\n');
  console.log('Usage: s3-photo [--config /path/to/config.yml] dirOrPhoto1 dirOrPhoto2 ...')
}

function resizeAndUpload(filename, params, callback) {
  var basename = path.basename(filename);
  var dir = path.dirname(filename);
  var basePath = dir.replace(params.config.basePath, '');
  var s3BaseKey = path.join(params.config.baseKey, normalize(basePath));

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
    console.log(chalk.green('    Upload complete:') + ' original size');

    async.eachSeries(config.sizes, function(size, callback) {
      var sizeStr = size.map(function(i) {
        return i.toString().trim();
      }).join('x');
      var s3Key = s3BaseKey + 'sizes/' + sizeStr + '/' + basename;

      gm(filename)
        .resize(size[0], size[1])
        .quality(config.quality)
        .stream(function (err, stdout, stderr) {
          if (!err) {
            upload(stdout, s3Key, function() {
              console.log(chalk.green('    Upload complete: ') + sizeStr);
              callback()
            });
          } else {
            callback(err);
          }
        });
    }, function(err) {
      callback(err, s3BaseKey);
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

function getSecret(filename, config) {
  var parts = filename
      .replace(config.basePath, '')
      .split('/')
      .filter((function(part) {
        return part.length > 0;
      }));

  if (config.secret) {
    return hash(filename, config.salt);
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
