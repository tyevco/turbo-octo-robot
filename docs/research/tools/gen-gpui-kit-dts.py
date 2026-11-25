#!/usr/bin/env python3
"""Reconstructs gpui-kit.d.ts exactly as typings::declarations_with_components
emits it for FrozenComponentRegistry::default() with no host modules (the
app-dir copy herdr writes in mods::write_workspace before install_policy).
Reads Rust sources only; runs nothing from them.

Usage: gen-gpui-kit-dts.py <herdr-src> <gpui-pre-macros-0.3.8/src> docs/research/gpui-kit.d.ts
then:  node tools/mock/extract-methods.mjs   (rewrites tools/mock/gpui-methods.{json,js})

The output is gitignored. tools/mock/gpui-methods.json is the committed,
checked artefact and records the sha256 of the .d.ts it came from;
test/tooling/gpui.test.mjs compares it with a fresh extraction only when the
.d.ts exists, so npm test passes on a fresh clone without herdr sources."""
import re, sys
if len(sys.argv) != 4:
    sys.exit(__doc__)
SRC = sys.argv[1]          # herdr-src root
MACROS = sys.argv[2]       # gpui-pre-macros-0.3.8/src
OUT = sys.argv[3]
RELEASE = True             # cfg(debug_assertions) off in release builds

typ = open(f"{SRC}/vendor/gpui-kit/crates/shell/src/typings.rs").read()
style_rs = open(f"{SRC}/vendor/gpui-kit/crates/shell/src/style.rs").read()

def raw_const(name):
    m = re.search(r'const %s: &str = r#"(.*?)"#;' % name, typ, re.S)
    assert m, name
    return m.group(1)

def unescape_rust(s):
    out = []; i = 0
    while i < len(s):
        c = s[i]
        if c == '\\':
            n = s[i+1]
            if n == '\n':
                i += 2
                while i < len(s) and s[i] in ' \t\n\r':
                    i += 1
                continue
            mp = {'n': '\n', 't': '\t', '"': '"', '\\': '\\', "'": "'", '0': '\0', 'r': '\r'}
            if n in mp:
                out.append(mp[n]); i += 2; continue
            if n == 'u':
                m = re.match(r'u\{([0-9a-fA-F]+)\}', s[i+1:])
                out.append(chr(int(m.group(1), 16))); i += 1 + m.end(); continue
            raise ValueError(n)
        out.append(c); i += 1
    return ''.join(out)

m = re.search(r'const PREAMBLE: &str = "(.*?)";\n\nconst VALUE_TYPES', typ, re.S)
PREAMBLE = unescape_rust(m.group(1))

# ---------- style tables (style.rs) ----------
def tuple_table(name):
    m = re.search(r'const %s: &\[\(&str, (?:&str|NullaryFn)\)\] = &\[(.*?)\n\];' % name, style_rs, re.S)
    body = m.group(1)
    body = re.sub(r'//[^\n]*', '', body)
    return re.findall(r'\(\s*"([^"]+)",\s*(?:"((?:[^"\\]|\\.)*)"|\|)', body)

PARAM_STYLES = [(n, unescape_rust(d)) for n, d in tuple_table("PARAM_STYLES")]
EXTRA_NULLARY = [n for n, _ in tuple_table("EXTRA_NULLARY")]
EXTRA_NULLARY_DOCS = [(n, unescape_rust(d)) for n, d in tuple_table("EXTRA_NULLARY_DOCS")]
assert len(PARAM_STYLES) == 59, len(PARAM_STYLES)
assert EXTRA_NULLARY == [n for n, _ in EXTRA_NULLARY_DOCS]
PARAM_NAMES = [n for n, _ in PARAM_STYLES]

# ---------- reflection of hand-written trait methods ----------
def reflect_trait(text, trait_start_regex):
    m = re.search(trait_start_regex, text)
    i = m.end()
    # trait body up to matching brace
    depth = 1; j = i
    while depth:
        if text[j] == '{': depth += 1
        elif text[j] == '}': depth -= 1
        j += 1
    body = text[i:j-1]
    lines = body.split('\n')
    methods = []; docs = []; cfgs = []; k = 0; level = 0
    while k < len(lines):
        line = lines[k]; s = line.strip()
        if level == 0:
            if s.startswith('///'):
                docs.append(s[3:]); k += 1; continue
            if s.startswith('#[cfg('):
                cfgs.append(s); k += 1; continue
            if s.startswith('#['):
                k += 1; continue
            fm = re.match(r'fn (\w+)', s)
            if fm:
                sig = s; kk = k
                while '{' not in sig and not sig.endswith(';'):
                    kk += 1; sig += ' ' + lines[kk].strip()
                head = sig.split('{')[0]
                params = re.search(r'\((.*?)\)\s*(->\s*([^{;]*?))?\s*(where|$|;)', head)
                plist = [p.strip() for p in re.split(r',(?![^<]*>)', params.group(1)) if p.strip()]
                ret = (params.group(3) or '').strip()
                recv = plist and plist[0] in ('self', 'mut self')
                if recv and len(plist) == 1 and ret == 'Self':
                    doc = None
                    if docs:
                        doc = '\n'.join(d[1:] if d.startswith(' ') else d for d in docs)
                    methods.append((fm.group(1), doc, list(cfgs)))
                docs = []; cfgs = []
                # skip body
                k = kk
                level += sig.count('{') - sig.count('}')
                k += 1; continue
            if s and not s.startswith('//'):
                docs = []; cfgs = []
            k += 1; continue
        else:
            level += line.count('{') - line.count('}')
            k += 1
    return methods

# ---------- macro-generated methods (gpui-pre-macros styles.rs) ----------
mac = open(f"{MACROS}/styles.rs").read()

def fn_body(name):
    m = re.search(r'\nfn %s\(\)[^{]*\{(.*?)\n\}\n' % name, mac, re.S)
    return m.group(1)

def prefixes(name):
    body = fn_body(name)
    out = []
    for blk in re.finditer(r'Prefix \{(.*?)\n        \}', body, re.S):
        b = blk.group(1)
        p = re.search(r'prefix: "([^"]+)"', b).group(1)
        auto = re.search(r'auto_allowed: (true|false)', b)
        d = re.search(r'doc_string_prefix: "((?:[^"\\]|\\.)*)"', b).group(1)
        out.append((p, None if not auto else auto.group(1) == 'true', unescape_rust(d)))
    return out

def suffixes(name):
    body = fn_body(name)
    out = []
    for blk in re.finditer(r'Suffix \{(.*?)\n        \}', body, re.S):
        b = blk.group(1)
        sfx = re.search(r'suffix: "([^"]*)"', b).group(1)
        d = re.search(r'doc_string_suffix: "((?:[^"\\]|\\.)*)"', b).group(1)
        out.append((sfx, unescape_rust(d)))
    return out

def predefined(name, length, negate, doc):
    q = '_neg' if negate else ''
    return (f'{name}{q}_{length}' if length else f'{name}{q}', doc)

def box_methods(pfx, sfx):
    res = []
    for p, auto, dp in pfx:
        for s, ds in sfx:
            doc = f'{dp}\n\n{ds}'
            if s != 'auto' or auto:
                res.append(predefined(p, s, False, doc))
            if s != 'auto':
                res.append(predefined(p, s, True, doc))
    return res

def quoted_methods(macro_fn):
    """Explicit `///`-documented nullary fns written inside a quote! block."""
    m = re.search(r'pub fn %s\(input: TokenStream\) -> TokenStream \{(.*?)\n\}\n' % macro_fn, mac, re.S)
    body = m.group(1)
    q = body[body.index('quote! {'):]
    res = []; docs = []
    for line in q.split('\n'):
        s = line.strip()
        if s.startswith('///'):
            docs.append(s[3:]); continue
        fm = re.match(r'#visibility fn (\w+)(<[^>]*>)?\((.*?)\)', s)
        if fm:
            params = [p for p in fm.group(3).split(',') if p.strip()]
            if len(params) == 1 and params[0].strip() in ('self', 'mut self') and '-> Self' in s:
                doc = '\n'.join(d[1:] if d.startswith(' ') else d for d in docs) if docs else None
                res.append((fm.group(1), doc))
            docs = []; continue
        if s.startswith('#(#methods)*'):
            res.append(('__METHODS__', None))
    return res

box_sfx = suffixes('box_style_suffixes')
generated = []
# style_helpers: box_prefixes then corners
generated += box_methods(prefixes('box_prefixes'), box_sfx)
for p, _, dp in prefixes('corner_prefixes'):
    for s, ds in suffixes('corner_suffixes'):
        generated.append(predefined(p, s, False, f'{dp}\n\n{ds}'))
generated += quoted_methods('visibility_style_methods')
generated += box_methods(prefixes('margin_box_style_prefixes'), box_sfx)
generated += box_methods(prefixes('padding_box_style_prefixes'), box_sfx)
pos = quoted_methods('position_style_methods')
pos_methods = box_methods(prefixes('position_box_style_prefixes'), box_sfx)
for n, d in pos:
    if n == '__METHODS__': generated += pos_methods
    else: generated.append((n, d))
generated += quoted_methods('overflow_style_methods')
generated += quoted_methods('cursor_style_methods')
border_methods = []
for p, _, dp in prefixes('border_prefixes'):
    for s, ds in suffixes('border_suffixes'):
        border_methods.append(predefined(p, s, False, f'{dp}\n\n{ds}'))
for n, d in quoted_methods('border_style_methods'):
    if n == '__METHODS__': generated += border_methods
    else: generated.append((n, d))
generated += quoted_methods('box_shadow_style_methods')
generated = [g for g in generated if g[0] != '__METHODS__']

gpui_styled = open(f"{SRC}/vendor/gpui-pre/src/styled.rs").read()
explicit = reflect_trait(gpui_styled, r'pub trait Styled: Sized \{')
gpui_list = generated + [(n, d) for n, d, c in explicit
                         if not (RELEASE and any('debug_assertions' in x for x in c))]
base_styled = open(f"{SRC}/vendor/gpui-kit/crates/base/src/styled.rs").read()
base_list = [(n, d) for n, d, c in reflect_trait(base_styled, r'pub trait StyledExt: Styled \+ Sized \{')]

nullary_table = base_list + gpui_list
by_name = {}
for idx, (n, d) in enumerate(nullary_table):
    by_name.setdefault(n, idx)
for n in EXTRA_NULLARY:
    by_name.setdefault(n, None)

def documentation(name):
    for n, d in PARAM_STYLES:
        if n == name: return d
    for n, d in EXTRA_NULLARY_DOCS:
        if n == name: return d
    if name in by_name and by_name[name] is not None:
        return nullary_table[by_name[name]][1]
    return None

known = sorted(set([n for n, _ in nullary_table] + EXTRA_NULLARY + PARAM_NAMES),
               key=lambda s: s.encode())
nullary = [n for n in known if n not in PARAM_NAMES]
parametric = [n for n in known if n in PARAM_NAMES]
for n in PARAM_NAMES:
    assert n not in [x for x, _ in nullary_table], f'{n} both reflected and bound'

LENGTH = {'w','h','size','min_w','min_h','min_size','max_w','max_h','max_size',
          'm','mx','my','mt','mb','ml','mr','inset','top','bottom','left','right','flex_basis'}
DEFINITE = {'p','px','py','pt','pb','pl','pr','gap','gap_x','gap_y','line_height'}
ABSOLUTE = {'text_size','border','border_t','border_b','border_l','border_r','border_x','border_y',
            'rounded','rounded_t','rounded_b','rounded_l','rounded_r','rounded_tl','rounded_tr','rounded_bl','rounded_br'}
COLOR = {'bg','text_color','text_bg','border_color'}
NUMBER = {'flex_grow','flex_shrink','opacity','font_weight'}
def argument_of(name):
    if name == 'font_family': return 'string'
    if name == 'font_weight': return 'number'
    if name in COLOR: return 'Color'
    if name in LENGTH: return 'Length'
    if name in DEFINITE: return 'DefiniteLength'
    if name in ABSOLUTE: return 'AbsoluteLength'
    if name in NUMBER: return 'number'
    return 'never'
assert set(PARAM_NAMES) == LENGTH | DEFINITE | ABSOLUTE | COLOR | NUMBER | {'font_family'}

def doc_comment(text, indent):
    if text is None: return ''
    pad = ' ' * indent
    text = text.replace('*/', '*​/')
    lines = [l for l in text.split('\n') if l.strip()]
    if not lines: return ''
    first, rest = lines[0], lines[1:]
    if not rest:
        return f'{pad}/** {first.strip()} */\n'
    out = f'{pad}/**\n{pad} * {first.strip()}\n'
    for l in rest:
        out += f'{pad} *\n{pad} * {l.strip()}\n'
    out += f'{pad} */\n'
    return out

def parametric_styles():
    out = ("\n    // Style methods that take an argument. Which length type a method\n"
           "    // accepts follows its Rust signature, so `.p(\"auto\")` and\n"
           "    // `.rounded(\"50%\")` are type errors here for the same reason they\n"
           "    // throw at run time.\n")
    for n in parametric:
        out += doc_comment(documentation(n), 4)
        out += f'    {n}<Self extends Element>(this: Self, value: {argument_of(n)}): Self;\n'
    return out

def nullary_styles():
    out = (f"\n    // The {len(nullary)} no-argument style methods, generated from GPUI's reflection\n"
           "    // table. A name here is a name the runtime dispatches, and the\n"
           "    // documentation is GPUI's own.\n")
    for n in nullary:
        out += doc_comment(documentation(n), 4)
        out += f'    {n}<Self extends Element>(this: Self): Self;\n'
    return out

# ---------- other generated pieces ----------
ver = re.search(r'^version = "([^"]+)"', open(f"{SRC}/vendor/gpui-kit/crates/shell/Cargo.toml").read(), re.M).group(1)
tt = open(f"{SRC}/vendor/gpui-kit/crates/shell/src/theme_tokens.rs").read()
COLOR_TOKENS = re.findall(r'"(\w+)"', re.search(r'COLOR_TOKEN_NAMES: &\[&str\] = &\[(.*?)\];', tt, re.S).group(1))
a11y = open(f"{SRC}/vendor/gpui-kit/crates/shell/src/a11y.rs").read()
roles_src = re.search(r'#\[rustfmt::skip\]\nroles!\((.*?)\);', a11y, re.S).group(1)
ROLES = [r for r in re.findall(r'\w+', roles_src)]
def snake(v):
    return ''.join(('_' if i > 0 else '') + c.lower() if c.isupper() else c for i, c in enumerate(v))
mat = open(f"{SRC}/vendor/gpui-kit/crates/shell/src/materialize.rs").read()
ANCHORS = re.findall(r'"(\w+)"', re.search(r'ANCHOR_NAMES: \[&str; 8\] = \[(.*?)\];', mat, re.S).group(1))

def color_types():
    return ("  /**\n"
            "   * A concrete `#rgb`, `#rrggbb`, or `#rrggbbaa` color value.\n"
            "   * Read semantic colors from `cx.theme().colors`; bare token names are\n"
            "   * intentionally not accepted.\n"
            "   */\n"
            "  export type Color = `#${string}`;\n\n")
def base_color_token_type():
    out = "  /** Every semantic color token the installed Base palette defines. */\n  export type ColorToken =\n"
    for n in COLOR_TOKENS: out += f'    | "{n}"\n'
    return out + "    ;\n\n"
def role_type():
    out = ("  /**\n"
           "   * An accessibility role, mirroring `gpui::Role` in snake_case.\n"
           "   *\n"
           "   * `generic_container` is deliberately absent: GPUI filters that role\n"
           "   * out of the accessibility tree, so an element carrying it announces\n"
           "   * nothing while looking as though it announced something.\n"
           "   */\n"
           "  export type Role =\n")
    for r in ROLES: out += f'    | "{snake(r)}"\n'
    return out + "    ;\n\n"
def anchor_type():
    out = ("  /**\n"
           "   * Which corner of an anchored surface is pinned to its trigger,\n"
           "   * mirroring `gpui::Anchor` in snake_case.\n"
           "   */\n"
           "  export type Anchor =\n")
    for a in ANCHORS: out += f'    | "{a}"\n'
    out += "    ;\n\n"
    out += ("  /**\n"
            "   * A pointer button, for `on_mouse_down`, `on_mouse_up` and which one opens\n"
            "   * a `Popover`. HERDR: `back` and `forward` are the mouse's side buttons.\n"
            "   */\n")
    out += '  export type MouseButton = "left" | "right" | "middle" | "back" | "forward";\n\n'
    return out
def shell_types():
    out = "  /** The string forms accepted by gpui-shell's length bridge. */\n"
    out += "  export type LengthString = `${number}px` | `${number}rem` | `${number}%`;\n\n"
    out += "  /** The gpui-shell call scope reported by `cx.phase()`; unrelated to gpui::DispatchPhase. */\n"
    out += "  export type ScopePhase =\n"
    for p in ['render', 'event', 'task', 'layout']:
        out += f'    | "{p}"\n'
    out += '    | "none"\n    ;\n\n'
    out += raw_const('SHELL_TYPES')
    return out

out = ''
out += PREAMBLE.replace('{version}', ver)
out += 'declare module "gpui-kit" {\n'
out += raw_const('VALUE_TYPES')
out += color_types()
out += role_type()
out += anchor_type()
out += raw_const('CONTEXT_AND_VIEW')
out += "  /**\n"
out += "   * A description of one element, built by chaining.\n"
out += "   *\n"
out += "   * Every method returns the same element, so a chain is one\n"
out += "   * expression. An element is consumed when it is used as a child and\n"
out += "   * belongs to the render pass that built it; storing one and using it\n"
out += "   * again throws, which no type can prevent.\n"
out += "   */\n"
out += "  export type Element = NativeElement"
out += ";\n\n"
out += "  /** The fluent builder returned by native and Base element factories. */\n"
out += "  export interface NativeElement {\n"
out += raw_const('ELEMENT_METHODS')
out += ('    token(render: (token: import("gpui-base").InlineTokenContext, cx: Context) => Element | null): this;\n'
        '    on_token_click(listener: (event: import("gpui-base").InlineTokenClickEvent, cx: Context) => void): this;\n'
        '    on_token_hover(listener: (event: import("gpui-base").InlineTokenHoverEvent, cx: Context) => void): this;\n')
out += parametric_styles()
out += nullary_styles()
out += "  }\n"
out += raw_const('ELEMENTS')
out += raw_const('WINDOW')
out += raw_const('CAPABILITIES')
out += raw_const('SCHEDULING')
out += "}\n\n"
out += 'declare module "gpui" {\n  export * from "gpui-kit";\n}\n\n'
out += 'declare module "gpui-base" {\n'
out += raw_const('BASE_IMPORTS')
out += base_color_token_type()
out += raw_const('BASE_SHARED_TYPES')
out += raw_const('INLINE_TOKEN_TYPES')
out += raw_const('BASE')
out += "}\n\n"
out += 'declare module "gpui-component" {\n'
out += '  import { ClickEvent, Context, Element, NativeElement } from "gpui-kit";\n'
out += raw_const('INLINE_TOKEN_TYPES')
out += "}\n\n"
out += 'declare module "gpui-shell" {\n'
out += shell_types()
out += "}\n\n"
out += 'declare module "gpui-fps" {\n'
out += raw_const('FPS_IMPORTS')
out += raw_const('FPS')
out += "}\n"
out += raw_const('STANDARD_RUNTIME')
# host_modules(): empty at mods::write_workspace time (policy not yet installed)
out += raw_const('WINDOW_GLOBAL')
open(OUT, 'w').write(out)
print('nullary', len(nullary), 'parametric', len(parametric), 'base', len(base_list),
      'gpui generated', len(generated), 'gpui explicit', len(gpui_list) - len(generated), 'bytes', len(out.encode()))
dups = [n for n in set(x for x, _ in nullary_table) if [x for x, _ in nullary_table].count(n) > 1]
print('dups', dups)
