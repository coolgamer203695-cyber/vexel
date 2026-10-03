'use strict';

// Vexel type system — compile-time inference.

function t(kind, extra = {}) {
  return Object.assign({ kind }, extra);
}

const TInt = () => t('integer');
const TDec = () => t('decimal');
const TBool = () => t('boolean');
const TStr = () => t('string');
const TList = (element = null) => t('list', { element });
const TStruct = (structName, fieldTypes = {}) => t('struct', { structName, fieldTypes });
const TVoid = () => t('void');
const TNull = () => t('null');
const TUi = (uiKind) => t('ui', { uiKind });
const TTensor = (shape = null) => t('tensor', { shape });
const TModel = () => t('model');
const TEnum = (enumName, values = []) => t('enum', { enumName, values });
const TAny = () => t('any');
const TUnknown = () => t('unknown');
const TFunc = (paramCount) => t('function', { paramCount });

function typeName(ty) {
  if (!ty) return 'unknown';
  switch (ty.kind) {
    case 'integer': return 'integer';
    case 'decimal': return 'decimal';
    case 'boolean': return 'boolean';
    case 'string': return 'string';
    case 'list': return 'list';
    case 'struct': return ty.structName ? `struct ${ty.structName}` : 'struct';
    case 'void': return 'void';
    case 'null': return 'null';
    case 'ui': return ty.uiKind || 'ui element';
    case 'tensor': return 'tensor';
    case 'model': return 'model';
    case 'enum': return ty.enumName ? `enum ${ty.enumName}` : 'enum';
    case 'any': return 'any';
    case 'unknown': return 'unknown';
    case 'function': return 'function';
    default: return ty.kind;
  }
}

function isAny(ty) {
  return !ty || ty.kind === 'any' || ty.kind === 'unknown';
}

function sameType(a, b) {
  if (!a || !b) return true; // unknown matches anything for reassignment? No — handled separately
  if (a.kind === 'any' || b.kind === 'any') return true;
  if (a.kind === 'unknown' || b.kind === 'unknown') return true;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'struct') return a.structName === b.structName;
  if (a.kind === 'ui') return a.uiKind === b.uiKind;
  if (a.kind === 'enum') return a.enumName === b.enumName;
  return true;
}

function isNumeric(ty) {
  if (isAny(ty)) return true;
  return ty.kind === 'integer' || ty.kind === 'decimal';
}

function promoteNumeric(a, b) {
  if (isAny(a)) return b && !isAny(b) ? { ...b } : TAny();
  if (isAny(b)) return { ...a };
  if (a.kind === 'decimal' || b.kind === 'decimal') return TDec();
  return TInt();
}

module.exports = {
  t, TInt, TDec, TBool, TStr, TList, TStruct, TVoid, TNull, TUi, TTensor, TModel, TAny, TUnknown, TFunc, TEnum,
  typeName, isAny, sameType, isNumeric, promoteNumeric,
};
