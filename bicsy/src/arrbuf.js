bicsymaps.arrbuf = function() {
  var arrbuf = {},
      view,
      url,
      zoom = Math.round;

  arrbuf.view = function(x) {
    if (!arguments.length) return view;
    view = x;
    return arrbuf;
  };

  arrbuf.url = function(x) {
    if (!arguments.length) return url;
    url = typeof x === "string" && /{.}/.test(x) ? _url(x) : x;
    return arrbuf;
  };

  arrbuf.zoom = function(x) {
    if (!arguments.length) return zoom;
    zoom = typeof x === "function" ? x : function() { return x; };
    return arrbuf;
  };

  arrbuf.render = function(canvas, callback) {
    var context = canvas.getContext("2d"),
        viewSize = view.size(),
        viewAngle = view.angle(),
        viewCenter = view.center(),
        viewZoom = viewCenter[2],
        coordinateSize = view.coordinateSize();

    // compute the zoom offset and scale
    var dz = viewZoom - (viewZoom = zoom(viewZoom)),
        kz = Math.pow(2, -dz);

    // compute the coordinates of the four corners
    var c0 = view.coordinate([0, 0]),
        c1 = view.coordinate([viewSize[0], 0]),
        c2 = view.coordinate(viewSize),
        c3 = view.coordinate([0, viewSize[1]]);

    // apply the zoom offset to our coordinates
    c0[0] *= kz; c1[0] *= kz; c2[0] *= kz; c3[0] *= kz;
    c0[1] *= kz; c1[1] *= kz; c2[1] *= kz; c3[1] *= kz;
    c0[2] =      c1[2] =      c2[2] =      c3[2] -= dz;

    // compute the bounding box
    var x0 = Math.floor(Math.min(c0[0], c1[0], c2[0], c3[0])),
        x1 = Math.ceil(Math.max(c0[0], c1[0], c2[0], c3[0])),
        y0 = Math.floor(Math.min(c0[1], c1[1], c2[1], c3[1])),
        y1 = Math.ceil(Math.max(c0[1], c1[1], c2[1], c3[1])),
        dx = coordinateSize[0],
        dy = coordinateSize[1];

    // compute the set of visible tiles using scan conversion
    var tiles = [], z = c0[2], remaining = 0;
    scanTriangle(c0, c1, c2, push);
    scanTriangle(c2, c3, c0, push);
    function push(x, y) { remaining = tiles.push([x, y, z]); }

    // set the canvas size and transform
    var tx = viewSize[0] / 2 + dx * (x0 - viewCenter[0] * kz) | 0,
        ty = viewSize[1] / 2 + dy * (y0 - viewCenter[1] * kz) | 0;
    canvas.style.webkitTransform = "matrix3d(1,0,0,0,0,1,0,0,0,0,1,0," + tx + "," + ty + ",0,1)";
    canvas.width = (x1 - x0) * dx;
    canvas.height = (y1 - y0) * dy;

    function unMerc (pt, zm, tl) {
      var halfEarth = 20037508.342789,
          res0 = 156543.03392804097, 
          rv = Math.abs((pt + halfEarth) * zm / res0 - (tl*256))
      return rv
      //return rv * -1
    }

    function drawl (dv, idx, numRecs, tileX, tileY, xOffset, yOffset, zm) {
      // draw line from array of points
      context.beginPath()
      var n = 1,
          x = dv.getFloat64(idx, true),
          y = dv.getFloat64(idx+8, true)
      idx += 16
      context.moveTo(xOffset + unMerc(x, zm, tileX), yOffset + unMerc(y, zm, tileY))
      while (n < numRecs) {
        x = dv.getFloat64(idx, true)
        y = dv.getFloat64(idx+8, true)
        n+=1
        context.lineTo(xOffset + unMerc(x, zm, tileX), yOffset + unMerc(y, zm, tileY))
        idx += 16
      }
      context.stroke()
      context.closePath()    
      return idx + 1 // skip next endianness flag
    }

    // do whatever polygon stuff here and return new index value similarly

    // load each tile (hopefully from the cache) and draw it to the canvas
    tiles.forEach(function(tile) {
      var key = url(tile);

      //var tilex = [dx * (tile[0] - x0), dy * (tile[1] - y1)],
      
      // If there's something to show for this tile, show it.
      return key == null ? done() : bicsymaps_cache(key, function(bufRec) {
        if (!bufRec) return
        //try {
        //if (typeof bufRec.byteLength === 'undefined') return
        var fullLength = bufRec.byteLength,
            idx = 1, // assume little endian
            dv = new DataView(bufRec),
            xOffset = dx * (tile[0] - x0),
            yOffset = dy * (tile[1] - y0),
            yTileMax = 1 << tile[2],
            tileY = yTileMax - tile[1],
            multi = 0, skip, jump, wkbType,
            polygons = 0, multiLength = 0
        while (idx < fullLength) { // each of next 3 lines skips endianness flag
          if ((wkbType = dv.getUint32(idx, true)) === 2) { // probably does
            numRecs = dv.getUint32(idx + 4, true)
            idx = drawl (dv, idx + 8, numRecs, tile[0], tileY, xOffset, yOffset, yTileMax)
          }
          else if (wkbType === 3) {
            numRecs = polygons = dv.getUint32(idx + 4, true)
            while (polygons) {
              idx = drawl (dv, idx + 8, numRecs, tile[0], tileY, xOffset, yOffset, yTileMax) - 1
              polygons--
            }
            idx += 1 // resume endianness indifference
          }
          else if (wkbType > 3) { 
            idx += 9 // blow through array uncollecting collections, also assume little endian
            continue
          }
        }
        done();

      });

      // if that was the last tile, callback!
      function done() {
        if (!--remaining && callback) {
          callback();
        }
      }
    });

    return arrbuf;
  };

  return arrbuf;
};

// scan-line conversion
function edge(a, b) {
  if (a[1] > b[1]) { var t = a; a = b; b = t; }
  return {
    x0: a[0],
    y0: a[1],
    x1: b[0],
    y1: b[1],
    dx: b[0] - a[0],
    dy: b[1] - a[1]
  };
}

// scan-line conversion
function scanSpans(e0, e1, load) {
  var y0 = Math.floor(e1.y0),
      y1 = Math.ceil(e1.y1);

  // sort edges by x-coordinate
  if ((e0.x0 == e1.x0 && e0.y0 == e1.y0)
      ? (e0.x0 + e1.dy / e0.dy * e0.dx < e1.x1)
      : (e0.x1 - e1.dy / e0.dy * e0.dx < e1.x0)) {
    var t = e0; e0 = e1; e1 = t;
  }

  // scan lines!
  var m0 = e0.dx / e0.dy,
      m1 = e1.dx / e1.dy,
      d0 = e0.dx > 0, // use y + 1 to compute x0
      d1 = e1.dx < 0; // use y + 1 to compute x1
  for (var y = y0; y < y1; y++) {
    var x0 = Math.ceil(m0 * Math.max(0, Math.min(e0.dy, y + d0 - e0.y0)) + e0.x0),
        x1 = Math.floor(m1 * Math.max(0, Math.min(e1.dy, y + d1 - e1.y0)) + e1.x0);
    for (var x = x1; x < x0; x++) {
      load(x, y);
    }
  }
}

// scan-line conversion
function scanTriangle(a, b, c, load) {
  var ab = edge(a, b),
      bc = edge(b, c),
      ca = edge(c, a);

  // sort edges by y-length
  if (ab.dy > bc.dy) { var t = ab; ab = bc; bc = t; }
  if (ab.dy > ca.dy) { var t = ab; ab = ca; ca = t; }
  if (bc.dy > ca.dy) { var t = bc; bc = ca; ca = t; }

  // scan span! scan span!
  if (ab.dy) scanSpans(ca, ab, load);
  if (bc.dy) scanSpans(ca, bc, load);
}
