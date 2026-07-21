import { Type, freshTypeVar } from "./types";
import { Declaration, TypeDecl, AliasDecl } from "./ast";
import { RillError } from "./errors";

export interface CtorInfo {
  union: string;
  typeParams: string[];
  payload: Type | null;
}

export interface UnionInfo {
  name: string;
  params: string[];
  ctors: string[];
}

export interface AliasInfo {
  name: string;
  params: string[];
  type: Type;
}

export interface DeclEnv {
  unions: Map<string, UnionInfo>;
  aliases: Map<string, AliasInfo>;
  ctors: Map<string, CtorInfo>;
}

// Builds an env from declarations, layered on a base (the prelude env).
// Throws RillErrors (source-located via decl spans) for:
//  - duplicate type/alias name (within the program or colliding with base)
//  - duplicate constructor name ACROSS ALL types in scope (the Elm rule)
export function buildDeclEnv(decls: Declaration[], base?: DeclEnv): DeclEnv {
  const env: DeclEnv = {
    unions: new Map(base?.unions ?? []),
    aliases: new Map(base?.aliases ?? []),
    ctors: new Map(base?.ctors ?? []),
  };

  for (const decl of decls) {
    if (decl.kind === "TypeDecl") {
      if (env.unions.has(decl.name) || env.aliases.has(decl.name)) {
        throw new RillError(`Duplicate type/alias name: ${decl.name}`, decl.span);
      }

      const ctors: string[] = [];
      for (const ctor of decl.constructors) {
        if (env.ctors.has(ctor.name)) {
          throw new RillError(
            `Constructor ${ctor.name} already defined in another type`,
            ctor.span
          );
        }
        ctors.push(ctor.name);
        env.ctors.set(ctor.name, {
          union: decl.name,
          typeParams: decl.params,
          payload: ctor.payload,
        });
      }

      env.unions.set(decl.name, {
        name: decl.name,
        params: decl.params,
        ctors,
      });
    } else if (decl.kind === "AliasDecl") {
      if (env.unions.has(decl.name) || env.aliases.has(decl.name)) {
        throw new RillError(`Duplicate type/alias name: ${decl.name}`, decl.span);
      }

      env.aliases.set(decl.name, {
        name: decl.name,
        params: decl.params,
        type: decl.type,
      });
    }
  }

  return env;
}

// Resolves a parsed annotation: TUnion refs to alias names expand (recursively,
// substituting alias params; error on self-referential alias); TUnion refs to
// union names validate arity; unknown capitalized names throw a RillError with
// a did-you-mean suggestion. TParam nodes are only legal while resolving a
// declaration's own annotations (pass the active param list; elsewhere they error).
export function resolveTypeAnn(t: Type, env: DeclEnv, activeParams?: string[]): Type {
  switch (t.kind) {
    case "TParam": {
      if (!activeParams || !activeParams.includes(t.name)) {
        throw new RillError(
          `Type parameter ${t.name} not in scope`,
          undefined
        );
      }
      return t;
    }
    case "TUnion": {
      // Check if it's an alias
      if (env.aliases.has(t.name)) {
        const aliasInfo = env.aliases.get(t.name)!;
        if (t.args.length !== aliasInfo.params.length) {
          throw new RillError(
            `Alias ${t.name} expects ${aliasInfo.params.length} arguments, got ${t.args.length}`,
            undefined
          );
        }
        // Substitute params and recursively resolve
        const substitution = new Map<string, Type>();
        for (let i = 0; i < aliasInfo.params.length; i++) {
          substitution.set(aliasInfo.params[i], t.args[i]);
        }
        const expandedType = substituteAliasParams(aliasInfo.type, substitution);
        return resolveTypeAnn(expandedType, env, activeParams);
      }

      // Check if it's a union
      if (env.unions.has(t.name)) {
        const unionInfo = env.unions.get(t.name)!;
        if (t.args.length !== unionInfo.params.length) {
          throw new RillError(
            `Union ${t.name} expects ${unionInfo.params.length} arguments, got ${t.args.length}`,
            undefined
          );
        }
        // Recursively resolve args
        return {
          kind: "TUnion",
          name: t.name,
          args: t.args.map(arg => resolveTypeAnn(arg, env, activeParams)),
        };
      }

      // Unknown type - try to suggest
      const suggestion = suggestName(t.name, [
        ...env.unions.keys(),
        ...env.aliases.keys(),
      ]);
      const suggestionText = suggestion ? ` (did you mean ${suggestion}?)` : "";
      throw new RillError(
        `Unknown type ${t.name}${suggestionText}`,
        undefined
      );
    }
    case "TRecord": {
      return {
        kind: "TRecord",
        fields: new Map(
          [...t.fields.entries()].map(([k, v]) => [
            k,
            resolveTypeAnn(v, env, activeParams),
          ])
        ),
        rest: t.rest ? resolveTypeAnn(t.rest, env, activeParams) : null,
      };
    }
    case "TList": {
      return {
        kind: "TList",
        element: resolveTypeAnn(t.element, env, activeParams),
      };
    }
    case "TTuple": {
      return {
        kind: "TTuple",
        elements: t.elements.map(el => resolveTypeAnn(el, env, activeParams)),
      };
    }
    case "TFn": {
      return {
        kind: "TFn",
        param: resolveTypeAnn(t.param, env, activeParams),
        ret: resolveTypeAnn(t.ret, env, activeParams),
      };
    }
    case "TCon":
    case "TVar":
      return t;
  }
}

// Helper to substitute type parameters in an alias type
function substituteAliasParams(t: Type, subst: Map<string, Type>): Type {
  switch (t.kind) {
    case "TParam":
      return subst.has(t.name) ? subst.get(t.name)! : t;
    case "TRecord":
      return {
        kind: "TRecord",
        fields: new Map(
          [...t.fields.entries()].map(([k, v]) => [
            k,
            substituteAliasParams(v, subst),
          ])
        ),
        rest: t.rest ? substituteAliasParams(t.rest, subst) : null,
      };
    case "TList":
      return {
        kind: "TList",
        element: substituteAliasParams(t.element, subst),
      };
    case "TTuple":
      return {
        kind: "TTuple",
        elements: t.elements.map(el => substituteAliasParams(el, subst)),
      };
    case "TFn":
      return {
        kind: "TFn",
        param: substituteAliasParams(t.param, subst),
        ret: substituteAliasParams(t.ret, subst),
      };
    case "TUnion":
      return {
        kind: "TUnion",
        name: t.name,
        args: t.args.map(arg => substituteAliasParams(arg, subst)),
      };
    case "TCon":
    case "TVar":
      return t;
  }
}

// Fresh instantiation for a use site: returns the constructor's payload type
// (or null) and its union's type with the SAME fresh TVars substituted for params.
export function instantiateCtor(info: CtorInfo, env: DeclEnv): { unionType: Type; payload: Type | null } {
  const unionInfo = env.unions.get(info.union)!;

  // Create fresh type variables for each parameter
  const freshVars = new Map<string, Type>();
  for (const param of info.typeParams) {
    freshVars.set(param, freshTypeVar());
  }

  // Substitute params in the payload
  const payload = info.payload ? substituteAliasParams(info.payload, freshVars) : null;

  // Create the union type with fresh vars
  const unionType: Type = {
    kind: "TUnion",
    name: info.union,
    args: info.typeParams.map(param => freshVars.get(param)!),
  };

  return { unionType, payload };
}

// Nearest name by Levenshtein distance (<= 2) for did-you-mean; null if none close.
export function suggestName(name: string, candidates: Iterable<string>): string | null {
  let bestMatch: string | null = null;
  let bestDistance = Infinity;

  for (const candidate of candidates) {
    const distance = levenshteinDistance(name, candidate);
    if (distance <= 2 && distance < bestDistance) {
      bestMatch = candidate;
      bestDistance = distance;
    }
  }

  return bestMatch;
}

// Levenshtein distance calculation
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

// Creates the prelude declaration environment with Result and Option
export function createPreludeDeclEnv(): DeclEnv {
  const decls: Declaration[] = [];

  // type Result(a) = Ok(a) | Err(String)
  const resultDecl: TypeDecl = {
    kind: "TypeDecl",
    name: "Result",
    params: ["a"],
    constructors: [
      {
        name: "Ok",
        payload: { kind: "TParam", name: "a" },
        span: undefined as any,
      },
      {
        name: "Err",
        payload: { kind: "TCon", name: "String" },
        span: undefined as any,
      },
    ],
    span: undefined as any,
  };

  // type Option(a) = Some(a) | None
  const optionDecl: TypeDecl = {
    kind: "TypeDecl",
    name: "Option",
    params: ["a"],
    constructors: [
      {
        name: "Some",
        payload: { kind: "TParam", name: "a" },
        span: undefined as any,
      },
      {
        name: "None",
        payload: null,
        span: undefined as any,
      },
    ],
    span: undefined as any,
  };

  return buildDeclEnv([resultDecl, optionDecl]);
}
