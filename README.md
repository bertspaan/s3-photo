# s3-photo

Uploads photos (JPEG files) to S3, and generates thumbnails. Expects one command line argument:

- path to single photo, or
- path to single directory containing photos.

Installation:

    npm install bertspaan/s3-photo

## Configuration

See `config.example.json` for example configuration file. Copy this file, edit, and set the `S3_PHOTO_CONFIG` environment variable to the absolute path of the configuration file:

    export S3_PHOTO_CONFIG=/Users/bert/.s3-photo-config.json

In addition to `S3_PHOTO_CONFIG`, s3-photo expects two environment variables containing your S3 access keys:

    export AWS_ACCESS_KEY_ID='AKID'
    export AWS_SECRET_ACCESS_KEY='SECRET'

## Basepath

s3-photo will only process files and directories under the directory `basePath`. When uploading to S3, s3-photo does not change the directory structure of uploaded files, but it does add a directory called `sizes` to each upload, containing the thumbnails.

## Thumbnails

## Sectret directories
