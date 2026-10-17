//! Convert source-level xcss-web RSX into the exact framework's ordinary Rust DOM
//! and component builders, without expanding components or handwritten macros.
//!
//! The code generator is the same pinned, MIT-licensed implementation shipped
//! in xcss's integrated xcss-web snapshot. We deliberately disable inert HTML:
//! static elements must become DOM builder calls too, never HTML strings.
use anyhow::{Context, Result, bail, ensure};
use proc_macro2::{TokenStream, TokenTree};
use quote::quote;
use std::ops::Range;
use syn::spanned::Spanned;


#[path = "../../../web/xcss-web/vendor/xcss-web-macro/src/diagnostics.rs"]
#[rustfmt::skip]
#[allow(dead_code)]
mod diagnostics;
#[path = "../../../web/xcss-web/vendor/xcss-web-macro/src/view/mod.rs"]
#[rustfmt::skip]
mod view;

#[derive(Debug)]
pub struct Conversion {
    pub source: String,
    pub view_macros: usize,
    pub rounds: usize,
}

struct ViewMacro {
    range: Range<usize>,
    tokens: TokenStream,
    body: Range<usize>,
}
fn colon(token: &TokenTree) -> bool {
    matches!(token, TokenTree::Punct(p) if p.as_char() == ':')
}
fn find_views(tokens: TokenStream, output: &mut Vec<ViewMacro>) {
    let tokens: Vec<_> = tokens.into_iter().collect();
    let mut index = 0;
    while index < tokens.len() {
        if matches!(&tokens[index], TokenTree::Ident(name) if name == "view")
            && matches!(tokens.get(index + 1), Some(TokenTree::Punct(p)) if p.as_char() == '!')
            && let Some(TokenTree::Group(group)) = tokens.get(index + 2)
        {
            let mut start = index;
            while start >= 3
                && colon(&tokens[start - 1])
                && colon(&tokens[start - 2])
                && matches!(&tokens[start - 3], TokenTree::Ident(_))
            {
                start -= 3;
            }
            if start >= 2 && colon(&tokens[start - 1]) && colon(&tokens[start - 2]) {
                start -= 2;
            }
            output.push(ViewMacro {
                range: tokens[start].span().byte_range().start..group.span_close().byte_range().end,
                body: group.span_open().byte_range().end..group.span_close().byte_range().start,
                tokens: group.stream(),
            });
            // Outer RSX is one edit. Its nested views get fresh source spans
            // after that edit, rather than overlapping this source range.
            index += 3;
            continue;
        }
        if let TokenTree::Group(group) = &tokens[index] {
            // The erased upstream codegen wraps children in vec![...]. syn's
            // AST visitor cannot see nested views in opaque macro token trees.
            // Walking real source tokens handles vec!/cfg_if!/other wrappers,
            // while quoted strings remain a single literal and are untouched.
            find_views(group.stream(), output);
        }
        index += 1;
    }
}

fn component_adapter_lints(tokens: TokenStream) -> TokenStream {
    let mut output = TokenStream::new();
    let mut tokens = tokens.into_iter().peekable();
    let original = quote!(allow(clippy::let_and_return)).to_string();
    while let Some(token) = tokens.next() {
        if matches!(&token, TokenTree::Punct(p) if p.as_char() == '#')
            && matches!(tokens.peek(), Some(TokenTree::Group(g)) if g.delimiter() == proc_macro2::Delimiter::Bracket && g.stream().to_string() == original)
        {
            tokens.next();
            // The zero-props component builder returns (). These two lints
            // were hidden by macro source spans; keep the formal adapter's
            // evaluation exactly, scoped to that existing generated block.
            output.extend(
                quote!(#[allow(clippy::let_and_return, clippy::unit_arg, clippy::let_unit_value)]),
            );
        } else if let TokenTree::Group(group) = token {
            let mut rewritten =
                proc_macro2::Group::new(group.delimiter(), component_adapter_lints(group.stream()));
            rewritten.set_span(group.span());
            output.extend([TokenTree::Group(rewritten)]);
        } else {
            output.extend([token]);
        }
    }
    output
}

fn generate_expression(tokens: TokenStream) -> Result<syn::Expr> {
    let all: Vec<_> = tokens.into_iter().collect();
    let (global_class, start) = match all.as_slice() {
        [
            TokenTree::Ident(key),
            TokenTree::Punct(eq),
            value,
            TokenTree::Punct(comma),
            ..,
        ] if key == "class" && eq.as_char() == '=' && comma.as_char() == ',' => {
            (Some(value.clone()), 4)
        }
        [TokenTree::Ident(key), TokenTree::Punct(eq), ..]
            if key == "class" && eq.as_char() == '=' =>
        {
            bail!("view scope class requires its original trailing comma")
        }
        _ => (None, 0),
    };
    let input: TokenStream = all.into_iter().skip(start).collect();
    let config = rstml::ParserConfig::default().recover_block(true);
    let mut nodes = rstml::Parser::new(config)
        .parse_simple(input)
        .context("cannot parse the original view RSX")?;
    let rendered = view::render_view(&mut nodes, global_class.as_ref(), None, true)
        .context("the pinned xcss-web view code generator rejected this RSX")?
        .unwrap_or_else(|| quote!(()));
    syn::parse2(component_adapter_lints(rendered))
        .context("xcss-web generated a non-expression builder")
}

fn expression_source(expression: syn::Expr) -> Result<String> {
    // prettyplease only formats this replacement, not the original file. Thus
    // all original comments, whitespace and attributes outside RSX survive.
    let file: syn::File = syn::parse2(quote! {
        fn __rustify_view_expression() { #expression }
    })?;
    let formatted = prettyplease::unparse(&file);
    let body = formatted
        .strip_prefix("fn __rustify_view_expression() {\n")
        .and_then(|s| s.strip_suffix("}\n"))
        .context("unexpected expression formatter wrapper")?;
    Ok(body
        .lines()
        .map(|line| line.strip_prefix("    ").unwrap_or(line))
        .collect::<Vec<_>>()
        .join("\n"))
}

fn leaf_ranges(tokens: TokenStream, output: &mut Vec<Range<usize>>) {
    for token in tokens {
        if let TokenTree::Group(group) = token {
            output.push(group.span_open().byte_range());
            leaf_ranges(group.stream(), output);
            output.push(group.span_close().byte_range());
        } else {
            output.push(token.span().byte_range());
        }
    }
}

fn preserved_comments(source: &str, mac: &ViewMacro) -> Result<Vec<String>> {
    // A token span covers its complete string/raw-string literal, so searching
    // only inter-token gaps cannot mistake a URL or quoted // for a comment.
    let mut tokens = Vec::new();
    leaf_ranges(mac.tokens.clone(), &mut tokens);
    tokens.sort_by_key(|range| (range.start, range.end));
    let mut comments = Vec::new();
    let mut previous = mac.body.start;
    for token in tokens
        .into_iter()
        .chain(std::iter::once(mac.body.end..mac.body.end))
    {
        ensure!(
            token.start <= source.len() && token.end <= source.len(),
            "token range escaped the source file"
        );
        if token.start > previous {
            let gap = source
                .get(previous..token.start)
                .context("invalid UTF-8 comment boundary")?;
            if gap.contains("//") || gap.contains("/*") {
                comments.push(gap.trim().to_owned());
            }
        }
        previous = previous.max(token.end);
    }
    Ok(comments)
}

/// Replace only original source macro spans. Each nested pass reparses source
/// and obtains fresh, real spans; generated quote spans are never source edits.
pub fn convert(source: &str) -> Result<Conversion> {
    ensure!(
        cfg!(feature = "csr") && !cfg!(feature = "__internal_erase_components"),
        "this migration requires the actually compiled CSR-only host macro configuration"
    );
    ensure!(
        !source.starts_with('\u{feff}'),
        "remove the UTF-8 BOM before migration so source spans remain exact"
    );
    ensure!(
        !source.starts_with("#!") || source.starts_with("#!["),
        "Rust shebang sources require a separate migration"
    );
    let mut output = source.to_owned();
    let mut total = 0;
    for round in 0..=128 {
        syn::parse_file(&output).context("cannot parse Rust source")?;
        let tokens: TokenStream = output
            .parse::<TokenStream>()
            .map_err(|error| anyhow::anyhow!("cannot tokenize Rust source: {error}"))?;
        let mut found = Vec::new();
        find_views(tokens, &mut found);
        if found.is_empty() {
            return Ok(Conversion {
                source: shorten_paths(&output)?,
                view_macros: total,
                rounds: round,
            });
        }
        ensure!(round < 128, "nested view macro depth exceeded 128");
        found.sort_by_key(|mac| mac.range.start);
        for pair in found.windows(2) {
            ensure!(
                pair[0].range.end <= pair[1].range.start,
                "overlapping source macro spans"
            );
        }
        let mut replacements = Vec::new();
        for mac in found {
            let expression = generate_expression(mac.tokens.clone())?;
            let mut replacement = expression_source(expression)?;
            let comments = preserved_comments(&output, &mac)?;
            if !comments.is_empty() {
                replacement = format!("{{\n{}\n{}\n}}", comments.join("\n"), replacement);
            }
            ensure!(
                output.get(mac.range.clone()).is_some(),
                "invalid macro source range"
            );
            replacements.push((mac.range, replacement));
        }
        total += replacements.len();
        for (range, replacement) in replacements.into_iter().rev() {
            output.replace_range(range, &replacement);
        }
    }
    unreachable!()
}

/// Shorten only equivalent public xcss-web paths, never text/HTML/URL literals.
/// Component helpers receive explicit ordinary Rust imports; rendering adapters
/// use the prelude already required by the authored application views.
pub fn shorten_paths(source: &str) -> Result<String> {
    struct Rule {
        old: Vec<String>,
        new: &'static str,
        import: Option<&'static str>,
    }
    let rules: Vec<_> = [
        (
            "::xcss_web::tachys::html::element::",
            "xcss_web::html::",
            None,
        ),
        ("::xcss_web::tachys::html::event::", "xcss_web::ev::", None),
        ("::xcss_web::tachys::svg::", "xcss_web::svg::", None),
        ("::xcss_web::tachys::mathml::", "xcss_web::math::", None),
        ("::xcss_web::prelude::View::", "View::", None),
        ("::xcss_web::prelude::IntoRender::", "IntoRender::", None),
        (
            "::xcss_web::prelude::IntoMaybeErased::",
            "IntoMaybeErased::",
            None,
        ),
        (
            "::xcss_web::component::component_props_builder",
            "component_props_builder",
            Some("component_props_builder"),
        ),
        (
            "::xcss_web::component::component_view",
            "component_view",
            Some("component_view"),
        ),
    ]
    .into_iter()
    .map(|(old, new, import)| Rule {
        old: old
            .parse::<TokenStream>()
            .unwrap()
            .into_iter()
            .map(|t| t.to_string())
            .collect(),
        new,
        import,
    })
    .collect();
    fn scan(
        tokens: TokenStream,
        rules: &[Rule],
        edits: &mut Vec<(Range<usize>, &'static str)>,
        imports: &mut std::collections::BTreeSet<&'static str>,
    ) {
        let tokens: Vec<_> = tokens.into_iter().collect();
        let mut i = 0;
        while i < tokens.len() {
            let matched = rules.iter().find(|rule| {
                tokens
                    .get(i..i + rule.old.len())
                    .is_some_and(|s| s.iter().zip(&rule.old).all(|(a, b)| a.to_string() == *b))
            });
            if let Some(rule) = matched {
                edits.push((
                    tokens[i].span().byte_range().start
                        ..tokens[i + rule.old.len() - 1].span().byte_range().end,
                    rule.new,
                ));
                if let Some(import) = rule.import {
                    imports.insert(import);
                }
                i += rule.old.len();
                continue;
            }
            if let TokenTree::Group(group) = &tokens[i] {
                scan(group.stream(), rules, edits, imports);
            }
            i += 1;
        }
    }
    let parsed = syn::parse_file(source)?;
    let mut edits = Vec::new();
    let mut imports = std::collections::BTreeSet::new();
    scan(
        source
            .parse::<TokenStream>()
            .map_err(|e| anyhow::anyhow!("{e}"))?,
        &rules,
        &mut edits,
        &mut imports,
    );
    let mut output = source.to_owned();
    edits.sort_by_key(|(range, _)| range.start);
    for (range, replacement) in edits.into_iter().rev() {
        output.replace_range(range, replacement);
    }
    if !imports.is_empty() {
        let at = parsed
            .attrs
            .iter()
            .map(|a| a.span().byte_range().end)
            .max()
            .unwrap_or(0);
        output.insert_str(
            at,
            &format!(
                "\nuse xcss_web::component::{{{}}};\n",
                imports.into_iter().collect::<Vec<_>>().join(", ")
            ),
        );
    }
    syn::parse_file(&output)?;
    Ok(output)
}

/// Recover only the two erasure-only call shapes emitted by an early migration
/// whose metadata union did not match Cargo's actually compiled host features.
/// This is explicit and separate from normal conversion, never an implicit fix.
pub fn repair_erased_codegen(source: &str) -> Result<Conversion> {
    fn signature(tokens: TokenStream) -> Vec<String> {
        tokens.into_iter().map(|t| t.to_string()).collect()
    }
    fn matches(tokens: &[TokenTree], start: usize, pattern: &[String]) -> bool {
        tokens
            .get(start..start + pattern.len())
            .is_some_and(|slice| slice.iter().zip(pattern).all(|(a, b)| a.to_string() == *b))
    }
    fn scan(
        source: &str,
        tokens: TokenStream,
        patterns: &[Vec<String>; 2],
        edits: &mut Vec<(Range<usize>, String)>,
    ) -> Result<()> {
        let tokens: Vec<_> = tokens.into_iter().collect();
        let mut i = 0;
        while i < tokens.len() {
            let mut handled = false;
            for (kind, pattern) in patterns.iter().enumerate() {
                if matches(&tokens, i, pattern)
                    && let Some(TokenTree::Group(args)) = tokens.get(i + pattern.len())
                {
                    ensure!(
                        args.delimiter() == proc_macro2::Delimiter::Parenthesis,
                        "expected generated call arguments"
                    );
                    let range =
                        tokens[i].span().byte_range().start..args.span_close().byte_range().end;
                    let replacement = if kind == 0 {
                        let mut inside: Vec<_> = args.stream().into_iter().collect();
                        if matches!(inside.last(), Some(TokenTree::Punct(p)) if p.as_char() == ',')
                        {
                            inside.pop();
                        }
                        ensure!(
                            inside.len() == 3
                                && matches!(&inside[0],TokenTree::Ident(v) if v=="vec")
                                && matches!(&inside[1],TokenTree::Punct(p) if p.as_char()=='!'),
                            "StaticVec repair only accepts the generated vec![...] shape"
                        );
                        let TokenTree::Group(values) = &inside[2] else {
                            bail!("expected generated vec group")
                        };
                        ensure!(
                            values.delimiter() == proc_macro2::Delimiter::Bracket,
                            "expected generated vec brackets"
                        );
                        let body = &source[values.span_open().byte_range().end
                            ..values.span_close().byte_range().start];
                        format!(
                            "({}{})",
                            body,
                            if body.trim_end().ends_with(',') {
                                ""
                            } else {
                                ","
                            }
                        )
                    } else {
                        let arg_tokens: Vec<_> = args.stream().into_iter().collect();
                        let end = match arg_tokens.last() {
                            Some(TokenTree::Punct(p)) if p.as_char() == ',' => {
                                p.span().byte_range().start
                            }
                            _ => args.span_close().byte_range().start,
                        };
                        let body = &source[args.span_open().byte_range().end..end];
                        body.to_owned()
                    };
                    edits.push((range, replacement));
                    i += pattern.len() + 1;
                    handled = true;
                    break;
                }
            }
            if handled {
                continue;
            }
            if let TokenTree::Group(group) = &tokens[i] {
                scan(source, group.stream(), patterns, edits)?;
            }
            i += 1;
        }
        Ok(())
    }
    let patterns = [
        signature(
            "::xcss_web::tachys::view::iterators::StaticVec::from"
                .parse()
                .unwrap(),
        ),
        signature("::xcss_web::__as_shared_reactive_fn".parse().unwrap()),
    ];
    let mut output = source.to_owned();
    let mut total = 0;
    for round in 0..=128 {
        syn::parse_file(&output)?;
        let tokens = output
            .parse::<TokenStream>()
            .map_err(|e| anyhow::anyhow!("{e}"))?;
        let mut edits = Vec::new();
        scan(&output, tokens, &patterns, &mut edits)?;
        if edits.is_empty() {
            return Ok(Conversion {
                source: shorten_paths(&output)?,
                view_macros: total,
                rounds: round,
            });
        }
        ensure!(round < 128, "generated repair nesting exceeded 128");
        total += edits.len();
        edits.sort_by_key(|(range, _)| range.start);
        for (range, replacement) in edits.into_iter().rev() {
            output.replace_range(range, &replacement);
        }
    }
    unreachable!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_builders_preserve_events_components_properties_svg_and_nested_views() {
        let source = r#"
use xcss_web::prelude::*;
// Outside security policy stays exactly here.
#[component]
fn Example() -> impl IntoView {
    let value = RwSignal::new(String::new());
    view! {<div class="layout"><svg><path d="M0 0"/></svg><Show when=move||!value.get().is_empty() fallback=move||view!{<p>"Empty"</p>}><input prop:value=move||value.get() on:input=move|ev|value.set(event_target_value(&ev))/></Show></div>}
}
"#;
        let changed = convert(source).unwrap();
        assert_eq!(changed.view_macros, 2);
        assert_eq!(changed.rounds, 2);
        assert!(
            changed
                .source
                .contains("// Outside security policy stays exactly here.")
        );
        assert!(changed.source.contains("#[component]"));
        assert!(changed.source.contains(".child("));
        assert!(changed.source.contains(".on("));
        assert!(changed.source.contains(".prop("));
        assert!(changed.source.contains("xcss_web::html::div()"));
        assert!(changed.source.contains("use xcss_web::component::"));
        assert!(changed.source.contains("clippy::unit_arg"));
        assert!(changed.source.contains("clippy::let_unit_value"));
        assert!(!changed.source.contains("#![allow"));
        assert!(!changed.source.contains("tachys::html::element"));
        assert!(changed.source.contains("component_props_builder"));
        assert!(!changed.source.contains("view!"));
        assert!(!changed.source.contains("InertElement"));
        assert!(!changed.source.contains("inner_html"));
        syn::parse_file(&changed.source).unwrap();
    }

    #[test]
    fn comments_inside_rsx_are_kept_but_urls_and_raw_literals_are_not_comments() {
        let source = r##"
fn ui() -> impl IntoView {
    let original = "中文 before view!";
    view! {<div>{
        // Do not trust this unvalidated field.
        let url = "https://example.org/";
        /* keep this /* nested */ security comment */
        format!("{} {}", url, r#"literal // not a comment"#)
    }</div>}
}
"##;
        let changed = convert(source).unwrap();
        assert_eq!(
            changed
                .source
                .matches("Do not trust this unvalidated field.")
                .count(),
            1
        );
        assert_eq!(
            changed.source.matches("nested */ security comment").count(),
            1
        );
        assert_eq!(changed.source.matches("https://example.org/").count(), 1);
        assert_eq!(
            changed.source.matches("literal // not a comment").count(),
            1
        );
        assert!(changed.source.contains("中文 before view!"));
    }

    #[test]
    fn statement_macros_fragments_and_unicode_offsets_are_source_exact() {
        let source =
            "// prefix 中文\nfn ui(){let x=\"中文\";view!{<>\"a\"<p>{x}</p></>}; let keep=42;}\n";
        let changed = convert(source).unwrap();
        assert_eq!(changed.view_macros, 1);
        assert!(
            changed
                .source
                .starts_with("// prefix 中文\nfn ui(){let x=\"中文\";")
        );
        assert!(changed.source.ends_with("; let keep=42;}\n"));
        assert_eq!(convert(&changed.source).unwrap().view_macros, 0);
    }

    #[test]
    fn nested_views_inside_opaque_rust_macros_are_not_silently_skipped() {
        let changed =
            convert("fn ui(){vec![xcss_web::view!{<p>\"one\"</p>}, view!{<i>\"two\"</i>}];}")
                .unwrap();
        assert_eq!(changed.view_macros, 2);
        assert!(!changed.source.contains("view!"));
        syn::parse_file(&changed.source).unwrap();
    }

    #[test]
    fn explicit_recovery_reverts_only_erased_codegen_and_keeps_comments() {
        let source = r#"// keep security note
fn ui(){::xcss_web::tachys::view::iterators::StaticVec::from(vec![html::p(),::xcss_web::__as_shared_reactive_fn(move||html::div())]);}"#;
        let recovered = repair_erased_codegen(source).unwrap();
        assert_eq!(recovered.view_macros, 2);
        assert!(recovered.source.starts_with("// keep security note"));
        assert!(!recovered.source.contains("StaticVec"));
        assert!(!recovered.source.contains("__as_shared_reactive_fn"));
        assert!(recovered.source.contains("move||html::div()"));
        syn::parse_file(&recovered.source).unwrap();
    }

    #[test]
    fn invalid_rsx_fails_without_a_partial_migration() {
        assert!(convert("fn ui(){view!{<div><p></div>}}").is_err());
        assert!(convert("fn ui(){view!{<div class=\"x\" class=\"y\"/>}}").is_err());
    }
}
