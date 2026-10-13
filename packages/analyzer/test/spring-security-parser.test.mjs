import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  antPatternToRegExp,
  SpringSecurityParser,
  classifyPath,
} from "../dist/spring-security-parser.js";

test("antPatternToRegExp: /** matches the prefix and any depth below it", () => {
  const re = antPatternToRegExp("/admin/**");

  assert.ok(re.test("/admin"), "bare prefix");
  assert.ok(re.test("/admin/analytics"), "one segment");
  // Regression: a naive two-step substitution produced ^/admin(?:/.[^/]*)?$,
  // which matched one segment but not two.
  assert.ok(re.test("/admin/billing/ledger"), "two segments");
  assert.ok(re.test("/admin/a/b/c/d"), "arbitrary depth");

  assert.ok(!re.test("/administrator"), "prefix is not a substring match");
  assert.ok(!re.test("/other/admin"), "anchored at the start");
});

test("antPatternToRegExp: single * stays within one path segment", () => {
  const re = antPatternToRegExp("/sitemap*.xml");

  assert.ok(re.test("/sitemap.xml"));
  assert.ok(re.test("/sitemap-jobs.xml"));
  assert.ok(!re.test("/sitemap/jobs.xml"), "must not cross a slash");
  assert.ok(!re.test("/sitemap.xml.bak"), "anchored at the end");
});

test("antPatternToRegExp: dots are literal, not wildcards", () => {
  const re = antPatternToRegExp("/robots.txt");

  assert.ok(re.test("/robots.txt"));
  assert.ok(!re.test("/robotsXtxt"));
});

test("antPatternToRegExp: exact paths match exactly", () => {
  const re = antPatternToRegExp("/pending");

  assert.ok(re.test("/pending"));
  assert.ok(!re.test("/pending/x"));
});

/** Writes a throwaway Spring project containing one security config. */
async function fixtureWith(securityConfigBody) {
  const root = await mkdtemp(join(tmpdir(), "toetslib-sec-"));
  const dir = join(root, "src", "main", "java", "demo");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SecurityConfig.java"),
    `package demo;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;

public class SecurityConfig {
\tpublic Object chain(HttpSecurity http) throws Exception {
${securityConfigBody}
\t\treturn http.build();
\t}
}
`
  );
  return join(root, "src", "main", "java");
}

test("inline chain: permitAll paths are not captured by the following hasRole", async () => {
  // One Java statement, so a regex spanning requestMatchers -> hasRole would
  // swallow the permitAll call and tag every public path as ADMIN.
  const srcDir = await fixtureWith(`\t\thttp.authorizeHttpRequests(auth -> auth
\t\t\t\t.requestMatchers("/", "/jobs", "/jobs/**", "/login").permitAll()
\t\t\t\t.requestMatchers("/admin/**").hasRole("ADMIN")
\t\t\t\t.requestMatchers("/company/**", "/pending").hasAnyRole("EMPLOYER", "OWNER")
\t\t\t\t.anyRequest().authenticated())
\t\t\t.formLogin(form -> form.loginPage("/login"));`);

  const model = await new SpringSecurityParser(srcDir).parse();

  assert.equal(model.loginRoute, "/login");
  assert.equal(model.denyByDefault, true);

  assert.deepEqual(classifyPath("/", model), {
    isPublic: true,
    authGuard: null,
  });
  assert.deepEqual(classifyPath("/jobs/engineer", model), {
    isPublic: true,
    authGuard: null,
  });
  assert.deepEqual(classifyPath("/admin/billing/ledger", model), {
    isPublic: false,
    authGuard: "ADMIN",
  });
  assert.deepEqual(classifyPath("/pending", model), {
    isPublic: false,
    authGuard: "EMPLOYER|OWNER",
  });
});

test("variable chain: a collected public-path list is honoured", async () => {
  const srcDir = await fixtureWith(`\t\tvar publicPaths = new java.util.ArrayList<>(java.util.List.of(
\t\t\t\t"/", "/jobs", "/pricing"));
\t\thttp.authorizeHttpRequests(auth -> auth
\t\t\t\t.requestMatchers(publicPaths.toArray(String[]::new)).permitAll()
\t\t\t\t.requestMatchers("/admin/**").hasRole("ADMIN")
\t\t\t\t.anyRequest().authenticated());`);

  const model = await new SpringSecurityParser(srcDir).parse();

  assert.equal(classifyPath("/pricing", model).isPublic, true);
  assert.equal(classifyPath("/admin/users", model).authGuard, "ADMIN");
});

test("deny-by-default: an unlisted path is treated as protected", async () => {
  const srcDir = await fixtureWith(`\t\thttp.authorizeHttpRequests(auth -> auth
\t\t\t\t.requestMatchers("/").permitAll()
\t\t\t\t.anyRequest().authenticated());`);

  const model = await new SpringSecurityParser(srcDir).parse();

  assert.deepEqual(classifyPath("/something/unlisted", model), {
    isPublic: false,
    authGuard: null,
  });
});

test("role names are never mistaken for URL patterns", async () => {
  const srcDir = await fixtureWith(`\t\thttp.authorizeHttpRequests(auth -> auth
\t\t\t\t.requestMatchers("/admin/**").hasRole("ADMIN")
\t\t\t\t.anyRequest().authenticated());`);

  const model = await new SpringSecurityParser(srcDir).parse();

  assert.deepEqual(
    model.rules.map((r) => r.pattern),
    ["/admin/**"]
  );
});
