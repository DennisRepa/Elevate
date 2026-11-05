/**
 * Elevate — the Gradle probe init script.
 *
 * Gradle is asked, not parsed (specs/README.md, "The probe protocol"). The
 * script is Groovy and uses no API that differs between Gradle 7.6.6, 8.14.3
 * and 9.8.1. It is written to `.gradle/elevate-<id>/probe.init.gradle` for the
 * time of a run. Every Gradle build of the run writes one answer file
 * `<outDir>/<mode>-<h>.json`, `h` being the first ten hex digits of the SHA-1
 * of the build's absolute directory. Standard output carries no answer.
 *
 * Every build of the run writes below the directory of the outermost build,
 * because a relative path is the client's (included builds and buildSrc have a
 * working directory of their own).
 *
 * The text contains neither backticks nor a dollar sign followed by a brace,
 * so it can live in a raw template literal.
 */
export const PROBE_INIT_SCRIPT: string = String.raw`import groovy.json.JsonOutput
import java.security.MessageDigest

// Elevate probe init script. Interface: -Delevate.mode=describe|lookup,
// -Delevate.outDir=<dir>, -Delevate.plan=<file> (lookup only).

// Included builds and buildSrc run this script too, with a start parameter of their own: the
// directory of the client is that of the outermost build (fact 27 holds for it only).
def elevateRoot = gradle
while (elevateRoot.parent != null) {
    elevateRoot = elevateRoot.parent
}

def elevateProp = { String key ->
    def fromArgs = elevateRoot.startParameter.systemPropertiesArgs[key]
    return fromArgs != null ? fromArgs : System.getProperty(key)
}

def elevateMode = elevateProp('elevate.mode')
if (elevateMode != 'describe' && elevateMode != 'lookup') {
    return
}

def elevateResolveFile = { String path ->
    def f = new File(path)
    return f.isAbsolute() ? f : new File(elevateRoot.startParameter.currentDir, path)
}

def elevateOutDir = elevateResolveFile(elevateProp('elevate.outDir'))
def elevateBlank = { Object v ->
    if (v == null) return null
    def s = String.valueOf(v)
    return s.trim().isEmpty() ? null : s
}

def elevateCleanUrl = { Object u ->
    if (u == null) return null
    return String.valueOf(u).replaceFirst('^([a-zA-Z][a-zA-Z0-9+.-]*://)[^/@]*@', '$1')
}

def elevateNormUrl = { Object u ->
    def c = elevateCleanUrl(u)
    return c == null ? null : c.replaceAll('/+$', '')
}

def elevateRepoDoc = { repo ->
    def name = String.valueOf(repo.name)
    def kind = 'other'
    def url = null
    if (repo instanceof org.gradle.api.artifacts.repositories.MavenArtifactRepository) {
        kind = 'maven'
        url = repo.url
    } else if (repo instanceof org.gradle.api.artifacts.repositories.IvyArtifactRepository) {
        kind = 'ivy'
        url = repo.url
    } else if (repo instanceof org.gradle.api.artifacts.repositories.FlatDirectoryArtifactRepository) {
        kind = 'flatDir'
    }
    if (name.startsWith('__plugin_repository__')) {
        kind = 'maven'
        url = null
    }
    return [name: name, kind: kind, url: elevateCleanUrl(url)]
}

def elevateWrite = { String mode, File dir, Map doc ->
    dir.mkdirs()
    def digest = MessageDigest.getInstance('SHA-1').digest(dir.absolutePath.getBytes('UTF-8'))
    def hex = new StringBuilder()
    digest.each { b -> hex.append(String.format('%02x', b & 0xff)) }
    def out = new File(elevateOutDir, mode + '-' + hex.toString().substring(0, 10) + '.json')
    elevateOutDir.mkdirs()
    out.setText(JsonOutput.toJson(doc), 'UTF-8')
}

def elevateExternal = { dep ->
    return dep instanceof org.gradle.api.artifacts.ExternalModuleDependency
}

def elevateState = [:]

// ---- settings-level facts (both modes) -----------------------------------

gradle.settingsEvaluated { settings ->
    elevateState.settingsDir = settings.settingsDir.absolutePath
    def drm = settings.dependencyResolutionManagement
    try {
        elevateState.repositoriesMode = String.valueOf(drm.repositoriesMode.get())
    } catch (Throwable ignored) {
        elevateState.repositoriesMode = null
    }
    elevateState.settingsRepositories = drm.repositories.collect { elevateRepoDoc(it) }
    elevateState.pluginRepositories = settings.pluginManagement.repositories.collect { elevateRepoDoc(it) }
    def settingsPlugins = []
    try {
        settings.buildscript.configurations.getByName('classpath').dependencies.each { dep ->
            if (elevateExternal(dep) && dep.name.endsWith('.gradle.plugin')) {
                settingsPlugins << [id: dep.group, version: elevateBlank(dep.version)]
            }
        }
    } catch (Throwable ignored) {
        // no buildscript classpath on these settings
    }
    elevateState.settingsPlugins = settingsPlugins
    elevateState.settingsRepoObjects = drm.repositories
}

// ---- lookup mode: protect internal groups on public repositories ---------

def elevatePlan = null
def elevatePublicUrls = []
def elevateInternalPatterns = []
if (elevateMode == 'lookup') {
    elevatePlan = new groovy.json.JsonSlurper().parse(elevateResolveFile(elevateProp('elevate.plan')))
    elevatePublicUrls = (elevatePlan.publicRepositoryUrls ?: []).collect { elevateNormUrl(it) }
    elevateInternalPatterns = elevatePlan.internalGroupPatterns ?: []
}

def elevateIsPublic = { repo ->
    def doc = elevateRepoDoc(repo)
    def url = doc.url
    if (url == null && String.valueOf(repo.name).startsWith('__plugin_repository__')) {
        def pluginName = String.valueOf(repo.name).substring('__plugin_repository__'.length())
        url = (elevateState.pluginRepoUrlByName ?: [:])[pluginName]
    }
    return url != null && elevatePublicUrls.contains(elevateNormUrl(url))
}

def elevateProtect = { repos ->
    repos.each { repo ->
        if (!elevateIsPublic(repo)) return
        elevateInternalPatterns.each { pattern ->
            try {
                repo.content { descriptor -> descriptor.excludeGroupByRegex(pattern) }
            } catch (Throwable ignored) {
                // a repository kind without content filters cannot be protected
            }
        }
    }
}

if (elevateMode == 'lookup') {
    gradle.settingsEvaluated { settings ->
        def byName = [:]
        settings.pluginManagement.repositories.each { r ->
            def d = elevateRepoDoc(r)
            byName[d.name] = d.url
        }
        elevateState.pluginRepoUrlByName = byName
        elevateProtect(settings.dependencyResolutionManagement.repositories)
    }
}

// ---- describe -------------------------------------------------------------

def elevateDescribeProject = { Project p ->
    def dependencies = []
    def constraints = []
    def projectDependencies = []
    p.configurations.each { cfg ->
        cfg.dependencies.each { dep ->
            if (dep instanceof org.gradle.api.artifacts.ProjectDependency) {
                def path
                try {
                    path = dep.path
                } catch (MissingPropertyException ignored) {
                    path = dep.dependencyProject.path
                }
                projectDependencies << [configuration: cfg.name, path: path]
            } else if (elevateExternal(dep)) {
                def vc = dep.versionConstraint
                def category = null
                try {
                    def attr = dep.attributes.getAttribute(org.gradle.api.attributes.Category.CATEGORY_ATTRIBUTE)
                    def n = attr == null ? null : String.valueOf(attr.name)
                    if (n == 'platform' || n == 'enforced-platform') category = n
                } catch (Throwable ignored) {
                    category = null
                }
                def artifact = dep.artifacts.isEmpty() ? null : dep.artifacts.iterator().next()
                dependencies << [
                    configuration: cfg.name,
                    group        : elevateBlank(dep.group),
                    name         : dep.name,
                    version      : elevateBlank(dep.version),
                    strictly     : elevateBlank(vc.strictVersion),
                    preferred    : elevateBlank(vc.preferredVersion),
                    rejected     : vc.rejectedVersions.collect { String.valueOf(it) },
                    category     : category,
                    fromCatalog  : dep instanceof org.gradle.api.artifacts.MinimalExternalModuleDependency,
                    classifier   : artifact == null ? null : elevateBlank(artifact.classifier),
                    extension    : artifact == null ? null : elevateBlank(artifact.extension),
                ]
            }
        }
        cfg.dependencyConstraints.each { c ->
            constraints << [
                configuration: cfg.name,
                group        : elevateBlank(c.group),
                name         : c.name,
                version      : elevateBlank(c.version),
                strictly     : elevateBlank(c.versionConstraint.strictVersion),
            ]
        }
    }
    def buildscriptDependencies = []
    try {
        p.buildscript.configurations.getByName('classpath').dependencies.each { dep ->
            if (elevateExternal(dep)) {
                buildscriptDependencies << [group: elevateBlank(dep.group), name: dep.name, version: elevateBlank(dep.version)]
            }
        }
    } catch (Throwable ignored) {
        // no buildscript classpath
    }
    def buildFile = p.buildFile != null && p.buildFile.exists() ? p.buildFile.absolutePath : null
    return [
        path                  : p.path,
        name                  : p.name,
        dir                   : p.projectDir.absolutePath,
        buildFile             : buildFile,
        group                 : elevateBlank(p.group),
        version               : elevateBlank(p.version),
        repositories          : p.repositories.collect { elevateRepoDoc(it) },
        buildscriptRepositories: p.buildscript.repositories.collect { elevateRepoDoc(it) },
        dependencies          : dependencies,
        constraints           : constraints,
        projectDependencies   : projectDependencies,
        buildscriptDependencies: buildscriptDependencies,
        tasks                 : ['testClasses', 'assemble'].findAll { p.tasks.names.contains(it) },
        lockfile              : new File(p.projectDir, 'gradle.lockfile').exists(),
    ]
}

if (elevateMode == 'describe') {
    gradle.projectsEvaluated { g ->
        def root = g.rootProject
        def dir = elevateState.settingsDir != null ? elevateState.settingsDir : root.projectDir.absolutePath
        def kind = g.parent == null ? 'root' : (root.name == 'buildSrc' && root.projectDir.name == 'buildSrc' ? 'buildSrc' : 'included')
        def all = root.allprojects.toList().sort { a, b ->
            a.path == ':' ? -1 : (b.path == ':' ? 1 : a.path <=> b.path)
        }
        def doc = [
            protocol     : 1,
            mode         : 'describe',
            gradleVersion: String.valueOf(g.gradleVersion),
            build        : [
                name                : root.name,
                kind                : kind,
                dir                 : dir,
                repositoriesMode    : elevateState.repositoriesMode,
                settingsRepositories: elevateState.settingsRepositories ?: [],
                pluginRepositories  : elevateState.pluginRepositories ?: [],
                settingsPlugins     : elevateState.settingsPlugins ?: [],
            ],
            projects     : all.collect { elevateDescribeProject(it) },
        ]
        elevateWrite('describe', new File(dir), doc)
    }
}

// ---- lookup ---------------------------------------------------------------

def elevateMessageLine = { Throwable t ->
    def m = t.message
    if (m == null || m.trim().isEmpty()) return t.class.simpleName
    return m.readLines().find { !it.trim().isEmpty() }?.trim() ?: t.class.simpleName
}

def elevateHasNotFound
elevateHasNotFound = { Throwable t, Set seen ->
    if (t == null || !seen.add(System.identityHashCode(t))) return false
    if (t.class.name.endsWith('ModuleVersionNotFoundException')) return true
    if (elevateHasNotFound(t.cause, seen)) return true
    try {
        def many = t.causes
        if (many != null) {
            for (c in many) {
                if (elevateHasNotFound(c, seen)) return true
            }
        }
    } catch (MissingPropertyException ignored) {
        // not a multi-cause exception
    }
    return false
}

def elevateFailureText = { Throwable t ->
    def start = t
    try {
        def many = t.causes
        if (many != null && !many.isEmpty()) start = many.iterator().next()
    } catch (MissingPropertyException ignored) {
        start = t
    }
    def parts = []
    def cur = start
    int guard = 0
    while (cur != null && guard++ < 20) {
        parts << elevateMessageLine(cur)
        cur = cur.cause
    }
    return parts.join(' > ')
}

def elevateLookupOne = { Project p, Map l ->
    def versions = []
    def error = null
    def isPlugin = l.kind == 'plugin'
    def handler = isPlugin ? p.buildscript : p
    def restore = null
    if (isPlugin && elevateInternalPatterns.any { pattern -> String.valueOf(l.group).matches(pattern) }) {
        def repos = p.buildscript.repositories
        def original = new ArrayList(repos)
        def publics = original.findAll { elevateIsPublic(it) }
        repos.removeAll(publics)
        restore = {
            repos.clear()
            repos.addAll(original)
        }
    }
    try {
        def dep = handler.dependencies.create(l.group + ':' + l.name + ':+')
        def conf = handler.configurations.detachedConfiguration(dep)
        conf.resolutionStrategy.cacheDynamicVersionsFor(0, 'seconds')
        conf.resolutionStrategy.componentSelection.all { sel ->
            versions << String.valueOf(sel.candidate.version)
            sel.reject('elevate lookup')
        }
        conf.resolve()
    } catch (Throwable t) {
        error = elevateHasNotFound(t, new HashSet()) ? null : elevateFailureText(t)
    } finally {
        if (restore != null) restore()
    }
    return [id: l.id, versions: versions, error: error]
}

if (elevateMode == 'lookup') {
    gradle.projectsEvaluated { g ->
        def root = g.rootProject
        def dir = elevateState.settingsDir != null ? elevateState.settingsDir : root.projectDir.absolutePath
        root.allprojects.each { p -> elevateProtect(p.repositories) }
        def results = []
        def mine = (elevatePlan.lookups ?: []).findAll { it.buildRoot == dir }
        root.allprojects { Project p ->
            mine.findAll { it.project == p.path }.each { l ->
                results << elevateLookupOne(p, l)
            }
        }
        elevateWrite('lookup', new File(dir), [protocol: 1, mode: 'lookup', results: results])
    }
}
`;
