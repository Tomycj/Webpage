!(function (n, t, e) {
	function u(n) {
		var t = this,
			e = (function () {
				var s = 4022871197;
				return function (n) {
					n = String(n);
					for (var t = 0; t < n.length; t++) {
						var e = 0.02519603282416938 * (s += n.charCodeAt(t));
						(e -= s = e >>> 0),
							(s = (e *= s) >>> 0),
							(s += 4294967296 * (e -= s));
					}
					return 2.3283064365386963e-10 * (s >>> 0);
				};
			})();
		(t.next = function () {
			var n = 2091639 * t.s0 + 2.3283064365386963e-10 * t.c;
			return (t.s0 = t.s1), (t.s1 = t.s2), (t.s2 = n - (t.c = 0 | n));
		}),
			(t.c = 1),
			(t.s0 = e(" ")),
			(t.s1 = e(" ")),
			(t.s2 = e(" ")),
			(t.s0 -= e(n)),
			t.s0 < 0 && (t.s0 += 1),
			(t.s1 -= e(n)),
			t.s1 < 0 && (t.s1 += 1),
			(t.s2 -= e(n)),
			t.s2 < 0 && (t.s2 += 1),
			(e = null);
	}
	function o(n, t) {
		return (t.c = n.c), (t.s0 = n.s0), (t.s1 = n.s1), (t.s2 = n.s2), t;
	}
	function s(n, t) {
		var e = new u(n),
			s = t && t.state,
			r = e.next;
		return (
			(r.int32 = function () {
				return (4294967296 * e.next()) | 0;
			}),
			(r.double = function () {
				return r() + 11102230246251565e-32 * ((2097152 * r()) | 0);
			}),
			(r.quick = r),
			s &&
				("object" == typeof s && o(s, e),
				(r.state = function () {
					return o(e, {});
				})),
			r
		);
	}
	t && t.exports
		? (t.exports = s)
		: e && e.amd
		? e(function () {
				return s;
		  })
		: (this.alea = s);
})(
	0,
	"object" == typeof module && module,
	"function" == typeof define && define
);
