'use strict';

var Fs = require('fs');
var Request = require('request');
var List = require('immutable').List;
var Promise = require('promise');
var Url = require('url');
var Mkdirp = require('mkdirp');

/**
 * @exports lib/document-downloader
 */

var DocumentDownloader = {};

DocumentDownloader.fetch = function (url) {
  return new Promise(function (resolve, reject) {
    Request.get(url, {
      timeout: 30000,
      encoding: null // If not specified, utf8 by default
    }, function (error, response, body) {
      if (error) {
        reject(new Error(
          'Fetching ' + url + ' triggered a network error: ' + error.message
        ));
      }
      else if (response.statusCode !== 200) {
        reject(new Error(
          'Fetching ' + url +
          ' triggered and HTTP error: code ' + response.statusCode
        ));
      }
      else resolve(body);
    });
  });
};

DocumentDownloader.fetchAll = function (urls) {
  return Promise.all(urls.toArray().map(this.fetch)).then(List);
};

DocumentDownloader.install = function (dest, content) {
  return Promise.denodeify(Fs.writeFile)(dest, content);
};

DocumentDownloader.installAll = function (destsContents) {
  // `e` is a tuple of [dest, content]
  return Promise.all(destsContents.toArray().map(function (e) {
    var path = require('path').dirname(e[0]);

    Mkdirp.sync(path);
    return DocumentDownloader.install(e[0], e[1]);
  }));
};

/**
 * Checks if a given filename is allowed to be published by the system.
 *
 * @param {string} filename - The filename to check against
 * @returns {boolean} `true` if the filename is allowed, `false` otherwise
 */
DocumentDownloader.isAllowed = function isAllowed(filename) {
  if (filename.toLowerCase().indexOf('.htaccess') !== -1) return false;
  else if (filename.toLowerCase().indexOf('.php') !== -1) return false;
  else if (filename.indexOf('../') !== -1) return false;
  else return true;
};

DocumentDownloader.fetchAndInstall = function (url, dest) {
  var _ = DocumentDownloader; // Class name shortener
  var mkdir = Promise.denodeify(Fs.mkdir);

  return new Promise(function (resolve) {
    Fs.exists(dest, function (exists) { resolve(exists); });
  }).then(function (pathExists) {
    if (!pathExists) return mkdir(dest);
  }).then(function () {
    return _.fetch(url).then(function (content) {
      var contentUtf8 = content.toString('utf8');

      if (contentUtf8.trim().charAt(0) !== '<') {
        var filenames = _.getFilenames(contentUtf8).filter(_.isAllowed);

        var dests = filenames
          .set(0, 'Overview.html')
          .map(function (filename) { return dest + '/' + filename; });

        var urls = filenames.map(function (filename) {
          // If an entry in the manifest had a space in it,
          // we assume it needs to be built from the spec-generator.
          // See https://github.com/w3c/spec-generator
          var specGeneratorComp = filename.split(' ');
          var absUrl = Url.resolve(url, specGeneratorComp[0]);

          if (specGeneratorComp.length === 2) {
            return global.SPEC_GENERATOR +
              '?type=' + encodeURIComponent(specGeneratorComp[1]) +
              '&url=' + encodeURIComponent(absUrl);
          }
          return absUrl;
        });

        return _.fetchAll(urls).then(function (contents) {
          return _.installAll(dests.zip(contents));
        });
      }
      else return _.install(dest + '/Overview.html', content);
    });
  });
};

DocumentDownloader.getFilenames = function getFilenames(manifest) {
  return manifest.split('\n').reduce(function (acc, line) {
    var filename = line.split('#')[0].trim();

    if (filename !== '') return acc.push(filename);
    else return acc;
  }, new List());
};

module.exports = DocumentDownloader;
