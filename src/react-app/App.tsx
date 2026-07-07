import { useEffect, useState } from "react";
import "./App.css";

interface GitHubUser {
	login: string;
	avatar_url: string;
	name: string;
	public_repos: number;
}

interface Commit {
	message: string;
	repo: string;
	date: string;
}

interface TropeDefinition {
	id: string;
	label: string;
	patterns: string[];
	hint: string;
}

interface BingoTile {
	id: string;
	label: string;
	matchCount: number;
	examples: string[];
	repoNames: string[];
	isMatched: boolean;
	isFreeSpace?: boolean;
}

const BOARD_SIDE = 5;
const BOARD_TILE_COUNT = BOARD_SIDE * BOARD_SIDE;
const FREE_SPACE_INDEX = Math.floor(BOARD_TILE_COUNT / 2);

const TROPE_DEFINITIONS: TropeDefinition[] = [
	{ id: "wip", label: "WIP", patterns: ["wip", "work in progress"], hint: "Half-finished commits that still got pushed." },
	{ id: "quick-fix", label: "Quick fix", patterns: ["quick fix", "hotfix", "temporary fix", "fast fix"], hint: "A change made to stop the bleeding." },
	{ id: "typo-fix", label: "Typo fix", patterns: ["typo", "spelling", "grammar"], hint: "A commit that only corrected text." },
	{ id: "docs-cleanup", label: "Docs cleanup", patterns: ["docs", "documentation", "readme", "guide"], hint: "The docs got some attention." },
	{ id: "dependency-bump", label: "Dependency bump", patterns: ["dependency", "dependencies", "package-lock", "lockfile", "upgrade"], hint: "A package version moved." },
	{ id: "merge-branch", label: "Merge branch", patterns: ["merge branch", "merge pull request", "merge remote-tracking"], hint: "A branch got folded in." },
	{ id: "refactor", label: "Refactor", patterns: ["refactor", "cleanup", "restructure", "reorganize"], hint: "Code changed without changing behavior." },
	{ id: "remove-dead-code", label: "Remove dead code", patterns: ["dead code", "unused", "remove unused", "delete unused"], hint: "Something got deleted for good reason." },
	{ id: "add-null-check", label: "Add null check", patterns: ["null check", "null", "undefined", "safety"], hint: "The classic guardrail commit." },
	{ id: "tests", label: "Tests", patterns: ["test", "tests", "spec", "coverage"], hint: "The safety net got updated." },
	{ id: "ci-green", label: "CI green", patterns: ["ci", "pipeline", "build passing", "green"], hint: "The build or pipeline was involved." },
	{ id: "rollback", label: "Rollback", patterns: ["rollback", "revert", "back out"], hint: "The previous change was undone." },
	{ id: "rename-things", label: "Rename things", patterns: ["rename", "renamed", "naming"], hint: "Symbols got a new name." },
	{ id: "edge-case", label: "Edge case", patterns: ["edge case", "special case", "corner case"], hint: "A weird branch of logic was handled." },
	{ id: "console-log", label: "Console log", patterns: ["console", "log", "debug"], hint: "Temporary debugging leftovers may lurk here." },
	{ id: "formatting-only", label: "Formatting only", patterns: ["format", "prettier", "lint", "style"], hint: "No behavior changed, just the shape of the code." },
	{ id: "better-naming", label: "Better naming", patterns: ["better name", "naming", "rename"], hint: "The code reads a little better now." },
	{ id: "api-change", label: "API change", patterns: ["api", "endpoint", "response", "request"], hint: "A contract probably shifted." },
	{ id: "build-fix", label: "Build fix", patterns: ["build", "compile", "tsc", "vite", "webpack"], hint: "The app needed to compile again." },
	{ id: "todo-cleanup", label: "TODO cleanup", patterns: ["todo", "fixme", "later"], hint: "A note to future self got addressed." },
	{ id: "legacy-cleanup", label: "Legacy cleanup", patterns: ["legacy", "old", "obsolete", "migration"], hint: "Old code or patterns got removed." },
	{ id: "lockfile-update", label: "Lockfile update", patterns: ["lockfile", "package-lock", "pnpm-lock", "yarn.lock"], hint: "Dependency metadata changed." },
	{ id: "permission-fix", label: "Permission fix", patterns: ["permission", "auth", "oauth", "login"], hint: "Access or auth handling changed." },
	{ id: "edge-deploy", label: "Edge deploy", patterns: ["worker", "cloudflare", "deploy", "edge"], hint: "Deployment or hosting changed." },
	{ id: "clean-up", label: "Cleanup", patterns: ["cleanup", "clean up", "tidy", "simplify"], hint: "The codebase got a bit lighter." },
];

function shuffleArray<T>(items: T[]) {
	const output = [...items];

	for (let index = output.length - 1; index > 0; index -= 1) {
		const swapIndex = Math.floor(Math.random() * (index + 1));
		[output[index], output[swapIndex]] = [output[swapIndex], output[index]];
	}

	return output;
}

function normalizeCommitMessage(message: string) {
	return message.split("\n")[0].trim().replace(/\s+/g, " ");
}

function classifyCommit(commit: Commit) {
	const text = normalizeCommitMessage(commit.message).toLowerCase();

	return TROPE_DEFINITIONS.find((trope) => trope.patterns.some((pattern) => text.includes(pattern))) ?? null;
}

function buildBingoBoard(commits: Commit[]): BingoTile[] {
	const aggregate = new Map<
		string,
		{
			count: number;
			latest: number;
			repos: Set<string>;
			examples: string[];
		}
	>();
	const unmatchedExamples: string[] = [];

	for (const commit of commits) {
		const trope = classifyCommit(commit);
		const timestamp = Number.isNaN(Date.parse(commit.date)) ? 0 : Date.parse(commit.date);
		const message = normalizeCommitMessage(commit.message);

		if (!trope) {
			unmatchedExamples.push(message);
			continue;
		}

		const entry = aggregate.get(trope.id);

		if (entry) {
			entry.count += 1;
			entry.latest = Math.max(entry.latest, timestamp);
			entry.repos.add(commit.repo);
			if (entry.examples.length < 3 && !entry.examples.includes(message)) {
				entry.examples.push(message);
			}
		} else {
			aggregate.set(trope.id, {
				count: 1,
				latest: timestamp,
				repos: new Set([commit.repo]),
				examples: [message],
			});
		}
	}

	const matchedTiles: BingoTile[] = [...aggregate.entries()]
		.sort((left, right) => {
			const leftEntry = left[1];
			const rightEntry = right[1];

			if (rightEntry.count !== leftEntry.count) {
				return rightEntry.count - leftEntry.count;
			}

			if (rightEntry.latest !== leftEntry.latest) {
				return rightEntry.latest - leftEntry.latest;
			}

			return left[0].localeCompare(right[0]);
		})
		.slice(0, BOARD_TILE_COUNT - 1)
		.map(([tropeId, details]) => {
			const trope = TROPE_DEFINITIONS.find((entry) => entry.id === tropeId);

			return {
				id: tropeId,
				label: trope?.label ?? tropeId,
				matchCount: details.count,
				examples: details.examples,
				repoNames: [...details.repos].slice(0, 2),
				isMatched: true,
			};
		});

	const seenIds = new Set(matchedTiles.map((tile) => tile.id));
	const remainingTropes = shuffleArray(TROPE_DEFINITIONS.filter((trope) => !seenIds.has(trope.id)))
		.slice(0, BOARD_TILE_COUNT - 1 - matchedTiles.length)
		.map((trope) => ({
			id: trope.id,
			label: trope.label,
			matchCount: 0,
			examples: unmatchedExamples.slice(0, 2),
			repoNames: [],
			isMatched: false,
		}));

	const board = shuffleArray([...matchedTiles, ...remainingTropes]).slice(0, BOARD_TILE_COUNT - 1);

	board.splice(FREE_SPACE_INDEX, 0, {
		id: "free-space",
		label: "FREE SPACE",
		matchCount: 0,
		examples: [],
		repoNames: [],
		isMatched: true,
		isFreeSpace: true,
	});

	return board;
}

function hasBingo(board: BingoTile[], selectedIds: Set<string>) {
	if (board.length !== BOARD_TILE_COUNT) {
		return false;
	}

	const isMarked = (index: number) => selectedIds.has(board[index].id);

	for (let row = 0; row < BOARD_SIDE; row += 1) {
		if (Array.from({ length: BOARD_SIDE }).every((_, column) => isMarked(row * BOARD_SIDE + column))) {
			return true;
		}
	}

	for (let column = 0; column < BOARD_SIDE; column += 1) {
		if (Array.from({ length: BOARD_SIDE }).every((_, row) => isMarked(row * BOARD_SIDE + column))) {
			return true;
		}
	}

	if (Array.from({ length: BOARD_SIDE }).every((_, index) => isMarked(index * BOARD_SIDE + index))) {
		return true;
	}

	if (Array.from({ length: BOARD_SIDE }).every((_, index) => isMarked(index * BOARD_SIDE + (BOARD_SIDE - index - 1)))) {
		return true;
	}

	return false;
}

function App() {
	const [user, setUser] = useState<GitHubUser | null>(null);
	const [commits, setCommits] = useState<Commit[]>([]);
	const [board, setBoard] = useState<BingoTile[]>([]);
	const [selectedTiles, setSelectedTiles] = useState<string[]>([]);
	const [lastGeneratedAt, setLastGeneratedAt] = useState<string>("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string>("");

	const selectedTileSet = new Set(selectedTiles);
	const bingoFound = hasBingo(board, selectedTileSet);
	const markedCount = selectedTiles.length;
	const commitRepoCount = new Set(commits.map((commit) => commit.repo)).size;
	const matchedTileCount = board.filter((tile) => tile.matchCount > 0).length;
	const unknownCommitCount = commits.filter((commit) => !classifyCommit(commit)).length;
	const topTropes = board
		.filter((tile) => tile.matchCount > 0)
		.sort((left, right) => right.matchCount - left.matchCount)
		.slice(0, 3);

	const generateBoard = (sourceCommits: Commit[]) => {
		const nextBoard = buildBingoBoard(sourceCommits);
		setBoard(nextBoard);
		setSelectedTiles(nextBoard.filter((tile) => tile.isFreeSpace).map((tile) => tile.id));
		setLastGeneratedAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
	};

	useEffect(() => {
		fetch("/api/user")
			.then((res) => (res.ok ? res.json() : null))
			.then((data) => {
				if (data && !data.error) {
					setUser(data);
				}
			})
			.catch(() => {
			});
	}, []);

	const handleLogin = () => {
		window.location.href = "/api/auth/login";
	};

	const handleLogout = () => {
		window.location.href = "/api/auth/logout";
	};

	const fetchCommits = async () => {
		setLoading(true);
		setError("");

		try {
			const response = await fetch("/api/commits");
			if (!response.ok) {
				throw new Error("Failed to fetch commits");
			}

			const data = await response.json();
			const nextCommits = data.commits || [];
			setCommits(nextCommits);
			generateBoard(nextCommits);
		} catch (err) {
			setError("Failed to load commits. Please try again.");
			console.error(err);
		} finally {
			setLoading(false);
		}
	};

	const toggleTile = (tileId: string) => {
		const tile = board.find((entry) => entry.id === tileId);

		if (!tile || tile.isFreeSpace) {
			return;
		}

		setSelectedTiles((current) =>
			current.includes(tileId)
				? current.filter((selectedId) => selectedId !== tileId)
				: [...current, tileId],
		);
	};

	const markMatchedTiles = () => {
		setSelectedTiles(board.filter((tile) => tile.isFreeSpace || tile.matchCount > 0).map((tile) => tile.id));
	};

	const clearMarks = () => {
		setSelectedTiles(board.filter((tile) => tile.isFreeSpace).map((tile) => tile.id));
	};

	return (
		<div className="app-shell">
			<main className="app-card">
				<header className="hero">
					<div className="eyebrow">GitHub commit bingo</div>
					<h1>See the tropes hiding in your commit history.</h1>
					<p>
						The board is built from generic commit tropes like WIP, typo fixes, hotfixes, merge
						commits, and dependency bumps. The app scans your commits, fills the board with the
						matching tropes, and shows the evidence behind each square.
					</p>
					<div className="hero-stats">
						<div className="stat-card">
							<span>{commits.length}</span>
							<label>commits loaded</label>
						</div>
						<div className="stat-card">
							<span>{matchedTileCount}</span>
							<label>matched trope tiles</label>
						</div>
						<div className="stat-card">
							<span>{unknownCommitCount}</span>
							<label>unclassified commits</label>
						</div>
					</div>
				</header>

				{!user ? (
					<section className="panel login-panel">
						<h2>Sign in with GitHub</h2>
						<p>
							Load your commits to get a trope board. Squares with matches are highlighted, and
							you can either mark them yourself or let the app auto-fill the hits.
						</p>
						<button onClick={handleLogin} className="primary-button">
							Connect GitHub
						</button>
					</section>
				) : (
					<>
						<section className="panel user-panel">
							<div className="user-info">
								<img src={user.avatar_url} alt={user.login} className="avatar" />
								<div>
									<p className="user-kicker">Connected account</p>
									<h2>{user.name || user.login}</h2>
									<p>@{user.login}</p>
								</div>
							</div>
							<div className="user-actions">
								<button onClick={fetchCommits} disabled={loading} className="primary-button">
									{loading ? "Loading commits..." : board.length ? "Reload trope board" : "Load trope board"}
								</button>
								<button onClick={markMatchedTiles} disabled={!board.length || loading} className="secondary-button">
									Auto-mark matches
								</button>
								<button onClick={clearMarks} disabled={!board.length || loading} className="secondary-button">
									Clear marks
								</button>
								<button onClick={() => generateBoard(commits)} disabled={!commits.length || loading} className="ghost-button">
									Shuffle tropes
								</button>
								<button onClick={handleLogout} className="ghost-button">
									Logout
								</button>
							</div>
							<div className="status-row">
								<div>
									<strong>{commits.length}</strong>
									<span>commits scanned</span>
								</div>
								<div>
									<strong>{commitRepoCount}</strong>
									<span>repos inspected</span>
								</div>
								<div>
									<strong>{lastGeneratedAt || "-"}</strong>
									<span>last generated</span>
								</div>
								<div>
									<strong>{markedCount}</strong>
									<span>marked squares</span>
								</div>
							</div>
							{error && <p className="error-banner">{error}</p>}
						</section>

						{board.length > 0 ? (
							<section className="board-layout">
								<aside className="panel board-note">
									<p className="user-kicker">How it works</p>
									<h2>Mark the trope squares that your history hits.</h2>
									<p>
										Each square is a generic trope. If your commits hit that pattern, the tile glows and
										shows a count plus sample messages that triggered it.
									</p>
									<p>
										Use auto-mark to fill the board with recognized tropes, or click squares yourself
										and go for a row, column, or diagonal.
									</p>
									<div className={`bingo-pill ${bingoFound ? "bingo-pill--active" : ""}`}>
										{bingoFound ? "Bingo line found" : "Keep marking squares"}
									</div>
									<div className="insight-list">
										{topTropes.map((tile) => (
											<div key={tile.id} className="insight-item">
												<strong>{tile.label}</strong>
												<span>{tile.matchCount} match{tile.matchCount === 1 ? "" : "es"}</span>
											</div>
										))}
									</div>
								</aside>

								<section className="panel board-panel">
									<div className="board-header">
										<div>
											<p className="user-kicker">Generated board</p>
											<h2>Trope Bingo</h2>
										</div>
										<p>
											{selectedTiles.length} / {board.length} marked
										</p>
									</div>

									<div className="bingo-grid">
										{board.map((tile) => {
											const isSelected = selectedTileSet.has(tile.id);

											return (
												<button
													key={tile.id}
													title={tile.examples.length ? tile.examples.join(" • ") : tile.label}
													className={`tile ${tile.isFreeSpace ? "tile--free" : ""} ${tile.isMatched ? "tile--matched" : ""} ${isSelected ? "tile--selected" : ""}`}
													onClick={() => toggleTile(tile.id)}
													disabled={tile.isFreeSpace}
												>
													<span className="tile-label">{tile.label}</span>
													<span className="tile-meta">
														{tile.isFreeSpace
															? "center square"
															: tile.matchCount > 0
																? `${tile.matchCount} match${tile.matchCount === 1 ? "" : "es"}`
																: "no matches yet"}
													</span>
													<span className="tile-note">
														{tile.isFreeSpace ? "free space" : tile.examples[0] || tile.label}
													</span>
												</button>
											);
										})}
									</div>
								</section>
							</section>
						) : (
							<section className="panel empty-state">
								<h2>No board yet</h2>
								<p>
									Load your commits to generate the first board. The app will create one automatically
									after the fetch completes.
								</p>
							</section>
						)}
					</>
				)}
			</main>
		</div>
	);
}

export default App;
