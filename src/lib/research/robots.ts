interface RobotsRule {
  path: string;
  allow: boolean;
}

interface RobotsGroup {
  userAgents: string[];
  rules: RobotsRule[];
}

function parseGroups(robotsTxt: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let sawRuleSinceLastAgent = true;

  const lines = robotsTxt.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;

    const [rawField, ...rest] = line.split(':');
    if (!rawField || rest.length === 0) continue;
    const field = rawField.trim().toLowerCase();
    const value = rest.join(':').trim();

    if (field === 'user-agent') {
      if (!current || sawRuleSinceLastAgent) {
        current = { userAgents: [], rules: [] };
        groups.push(current);
        sawRuleSinceLastAgent = false;
      }
      current.userAgents.push(value.toLowerCase());
    } else if (field === 'disallow' && current) {
      current.rules.push({ path: value, allow: value === '' });
      sawRuleSinceLastAgent = true;
    } else if (field === 'allow' && current) {
      current.rules.push({ path: value, allow: true });
      sawRuleSinceLastAgent = true;
    }
  }

  return groups;
}

function pathMatches(pattern: string, path: string): boolean {
  if (pattern === '') return false;
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\\\$$/, '$');
  const regex = new RegExp(`^${escaped}`);
  return regex.test(path);
}

/**
 * Minimal robots.txt evaluator: finds the most specific matching group for
 * our user-agent (falling back to "*"), then applies the longest matching
 * rule (Allow/Disallow) for the given path, per the standard's precedence.
 */
export function isAllowedByRobots(
  robotsTxt: string | null,
  path: string,
  userAgent: string
): boolean {
  if (!robotsTxt) return true;

  const groups = parseGroups(robotsTxt);
  if (groups.length === 0) return true;

  const ua = userAgent.toLowerCase();
  const specific = groups.find((g) => g.userAgents.some((a) => a !== '*' && ua.includes(a)));
  const wildcard = groups.find((g) => g.userAgents.includes('*'));
  const group = specific || wildcard;
  if (!group) return true;

  let bestMatch: RobotsRule | null = null;
  for (const rule of group.rules) {
    if (!pathMatches(rule.path, path)) continue;
    if (!bestMatch || rule.path.length > bestMatch.path.length) {
      bestMatch = rule;
    }
  }

  return bestMatch ? bestMatch.allow : true;
}
