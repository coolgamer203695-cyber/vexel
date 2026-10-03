'use strict';

// Vexel AST node constructors.
// Plain objects with `type` field; tokens carry positions.

function n(type, props) {
  return Object.assign({ type }, props);
}

module.exports = { n };
