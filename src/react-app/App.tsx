import { useEffect, useState } from "react";
import { toBlob } from "html-to-image";
import "./App.css";

interface GitHubUser {
	login: string;
	avatar_url: string;
	name: string;
	public_repos: number;
}

interface Commit {
	sha?: string;
	message: string;
	repo: string;
	date: string;
	files?: CommitFileSummary[];
	digest?: CommitDigest;
	tropeId?: string | null;
}

interface CommitFileSummary {
	filename: string;
	status: string;
	additions?: number;
	deletions?: number;
	changes?: number;
}

interface CommitDigest {
	language: string;
	changedFiles: string[];
	topFiles: string[];
	insight: string;
	confidence: "low" | "medium" | "high";
}

interface TropeDefinition {
	id: string;
	label: string;
	patterns: string[];
	hint: string;
}

interface MatchedCommit {
	sha: string;
	message: string;
	repo: string;
}

interface RoastData {
	archetype: string;
	roast: string;
	superpower: string;
	chaosRating: number;
}

interface BingoTile {
	id: string;
	label: string;
	hint?: string;
	matchCount: number;
	examples: string[];
	matchedCommits?: MatchedCommit[];
	repoNames: string[];
	digest?: CommitDigest;
	isMatched: boolean;
	isFreeSpace?: boolean;
}

interface ScreenshotToast {
	imageUri: string;
	message: string;
	hiding: boolean;
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
	if (commit.tropeId) {
		return TROPE_DEFINITIONS.find((t) => t.id === commit.tropeId) ?? null;
	}
	if (commit.tropeId === null) {
		return null;
	}

	const text = normalizeCommitMessage(commit.message).toLowerCase();

	return TROPE_DEFINITIONS.find((trope) =>
		trope.patterns.some((pattern) => {
			const escaped = pattern.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
			const regex = new RegExp(`\\b${escaped}\\b`, "i");
			return regex.test(text);
		})
	) ?? null;
}

function buildFallbackDigest(commit: Commit, tropeLabel: string): CommitDigest {
	const files = commit.files ?? [];
	const changedFiles = files.map((file) => file.filename);
	const topFiles = files
		.slice()
		.sort((left, right) => (right.changes ?? 0) - (left.changes ?? 0))
		.slice(0, 3)
		.map((file) => file.filename);

	let language = "code";
	if (changedFiles.some((file) => file.endsWith(".tsx") || file.endsWith(".ts") || file.endsWith(".jsx") || file.endsWith(".js"))) {
		language = "frontend";
	} else if (changedFiles.some((file) => file.endsWith(".css") || file.endsWith(".html"))) {
		language = "ui";
	} else if (changedFiles.some((file) => file.includes("package-lock") || file.includes("pnpm-lock") || file.includes("yarn.lock"))) {
		language = "dependencies";
	} else if (changedFiles.some((file) => file.includes("test") || file.includes("spec"))) {
		language = "tests";
	} else if (changedFiles.some((file) => file.endsWith(".md") || file.includes("docs") || file.includes("readme"))) {
		language = "docs";
	}

	return {
		language,
		changedFiles,
		topFiles,
		insight: `Representative ${tropeLabel.toLowerCase()} commit with ${changedFiles.length} changed file${changedFiles.length === 1 ? "" : "s"}.`,
		confidence: changedFiles.length >= 5 ? "high" : changedFiles.length >= 2 ? "medium" : "low",
	};
}

function buildBingoBoard(commits: Commit[]): BingoTile[] {
	const aggregate = new Map<
		string,
		{
			count: number;
			latest: number;
			repos: Set<string>;
			examples: string[];
			matchedCommits: MatchedCommit[];
			digest: CommitDigest;
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
			if (commit.sha && entry.matchedCommits.length < 5) {
				entry.matchedCommits.push({
					sha: commit.sha,
					message,
					repo: commit.repo,
				});
			}
		} else {
			aggregate.set(trope.id, {
				count: 1,
				latest: timestamp,
				repos: new Set([commit.repo]),
				examples: [message],
				matchedCommits: commit.sha ? [{ sha: commit.sha, message, repo: commit.repo }] : [],
				digest: commit.digest ?? buildFallbackDigest(commit, trope.label),
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
				hint: trope?.hint,
				matchCount: details.count,
				examples: details.examples,
				matchedCommits: details.matchedCommits,
				repoNames: [...details.repos].slice(0, 2),
				digest: details.digest,
				isMatched: true,
			};
		});

	const seenIds = new Set(matchedTiles.map((tile) => tile.id));
	const remainingTropes = shuffleArray(TROPE_DEFINITIONS.filter((trope) => !seenIds.has(trope.id)))
		.slice(0, BOARD_TILE_COUNT - 1 - matchedTiles.length)
		.map((trope) => ({
			id: trope.id,
			label: trope.label,
			hint: trope.hint,
			matchCount: 0,
			examples: [],
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
	const [shuffleCount, setShuffleCount] = useState(1);
	const [selectedTiles, setSelectedTiles] = useState<string[]>([]);
	const [expandedTileId, setExpandedTileId] = useState<string | null>(null);
	const [filterFrom, setFilterFrom] = useState<string>("");
	const [filterTo, setFilterTo] = useState<string>("");
	const [lastGeneratedAt, setLastGeneratedAt] = useState<string>("");
	const [shareStatus, setShareStatus] = useState<string>("");
	const [isSharing, setIsSharing] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string>("");
	const [roast, setRoast] = useState<RoastData | null>(null);
	const [roastLoading, setRoastLoading] = useState(false);
	const [roastError, setRoastError] = useState("");
	const [rerollsLeft, setRerollsLeft] = useState(3);
	const [activePreset, setActivePreset] = useState<string | null>("all");

	const [screenshotToast, setScreenshotToast] = useState<ScreenshotToast | null>(null);

	const closeToast = () => {
		setScreenshotToast((prev) => {
			if (!prev || prev.hiding) return prev;
			setTimeout(() => {
				URL.revokeObjectURL(prev.imageUri);
				setScreenshotToast(null);
			}, 400);
			return { ...prev, hiding: true };
		});
	};

	const showScreenshotToast = (blob: Blob, message: string) => {
		setScreenshotToast((prev) => {
			if (prev) {
				URL.revokeObjectURL(prev.imageUri);
			}
			const imageUri = URL.createObjectURL(blob);
			return {
				imageUri,
				message,
				hiding: false,
			};
		});
	};

	useEffect(() => {
		if (screenshotToast && !screenshotToast.hiding) {
			const timer = setTimeout(() => {
				setScreenshotToast((prev) => {
					if (!prev || prev.hiding) return prev;
					setTimeout(() => {
						URL.revokeObjectURL(prev.imageUri);
						setScreenshotToast(null);
					}, 400);
					return { ...prev, hiding: true };
				});
			}, 5000);
			return () => clearTimeout(timer);
		}
	}, [screenshotToast]);

	const [detailsCache, setDetailsCache] = useState<Record<string, { files: CommitFileSummary[]; digest: CommitDigest } | null>>({});
	const [detailsLoading, setDetailsLoading] = useState<Record<string, boolean>>({});
	const [detailsError, setDetailsError] = useState<Record<string, string>>({});

	const selectedTileSet = new Set(selectedTiles);
	const bingoFound = hasBingo(board, selectedTileSet);
	const markedCount = selectedTiles.length;
	const visibleCommits = commits.filter((commit) => {
		const commitTime = Date.parse(commit.date);

		if (Number.isNaN(commitTime)) {
			return false;
		}

		if (filterFrom) {
			const fromTime = Date.parse(`${filterFrom}T00:00:00`);

			if (!Number.isNaN(fromTime) && commitTime < fromTime) {
				return false;
			}
		}

		if (filterTo) {
			const toTime = Date.parse(`${filterTo}T23:59:59.999`);

			if (!Number.isNaN(toTime) && commitTime > toTime) {
				return false;
			}
		}

		return true;
	});
	const commitRepoCount = new Set(visibleCommits.map((commit) => commit.repo)).size;
	const matchedTileCount = board.filter((tile) => tile.matchCount > 0).length;
	const unknownCommitCount = visibleCommits.filter((commit) => !classifyCommit(commit)).length;
	const topTropes = board
		.filter((tile) => tile.matchCount > 0)
		.sort((left, right) => right.matchCount - left.matchCount)
		.slice(0, 3);
	const expandedTile = board.find((tile) => tile.id === expandedTileId) ?? null;

	const generateBoard = (sourceCommits: Commit[]) => {
		const nextBoard = buildBingoBoard(sourceCommits);
		setBoard(nextBoard);
		setSelectedTiles(nextBoard.filter((tile) => tile.isFreeSpace).map((tile) => tile.id));
		setLastGeneratedAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
		setRerollsLeft(3);
	};

	const fetchRoast = async (targetCommits: Commit[]) => {
		if (targetCommits.length === 0) return;
		setRoastLoading(true);
		setRoastError("");
		setRoast(null);

		// Commits arrive grouped by repo, so send them newest-first instead. That
		// way the roast draws from recent work across every repo rather than
		// fixating on whichever repo was fetched first.
		const roastCommits = [...targetCommits].sort(
			(left, right) => Date.parse(right.date) - Date.parse(left.date)
		);

		try {
			const response = await fetch("/api/roast", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ commits: roastCommits }),
			});

			if (!response.ok) {
				throw new Error("Failed to load AI roast");
			}

			const data = await response.json();
			setRoast(data);
		} catch (err) {
			console.error(err);
			setRoastError("AI reviewer is offline.");
		} finally {
			setRoastLoading(false);
		}
	};

	const rerollTile = (tileId: string) => {
		if (rerollsLeft <= 0) return;

		const currentTile = board.find((t) => t.id === tileId);
		if (!currentTile || currentTile.isFreeSpace || currentTile.isMatched) {
			return;
		}

		// 1. Get ids of all tropes currently on the board
		const boardTropeIds = new Set(board.map((t) => t.id));

		// 2. Filter TROPE_DEFINITIONS to find available ones
		const availableTropes = TROPE_DEFINITIONS.filter((t) => !boardTropeIds.has(t.id));

		if (availableTropes.length === 0) {
			return; // No more tropes left in the pool
		}

		// 3. Choose a random one
		const randomTrope = availableTropes[Math.floor(Math.random() * availableTropes.length)];

		// 4. Scan commits to see if we have matches for this new trope
		const matchedCommitsForTrope = visibleCommits.filter((c) => {
			const text = normalizeCommitMessage(c.message).toLowerCase();
			return randomTrope.patterns.some((pattern) => text.includes(pattern));
		});

		const newTile: BingoTile = {
			id: randomTrope.id,
			label: randomTrope.label,
			hint: randomTrope.hint,
			matchCount: matchedCommitsForTrope.length,
			examples: matchedCommitsForTrope.map((c) => normalizeCommitMessage(c.message)).slice(0, 3),
			matchedCommits: matchedCommitsForTrope.slice(0, 5).map((c) => ({
				sha: c.sha || "",
				message: normalizeCommitMessage(c.message),
				repo: c.repo,
			})),
			repoNames: [...new Set(matchedCommitsForTrope.map((c) => c.repo))].slice(0, 2),
			isMatched: matchedCommitsForTrope.length > 0,
		};

		// 5. Replace in board
		setBoard((currentBoard) =>
			currentBoard.map((tile) => (tile.id === tileId ? newTile : tile))
		);

		// 6. Decrement rerolls left
		setRerollsLeft((prev) => prev - 1);
	};

	const applyPreset = (days: number | null) => {
		if (days === null) {
			setFilterFrom("");
			setFilterTo("");
			setActivePreset("all");
			return;
		}

		const toDate = new Date();
		const fromDate = new Date();
		fromDate.setDate(toDate.getDate() - days);

		const formatDate = (date: Date) => {
			const yyyy = date.getFullYear();
			const mm = String(date.getMonth() + 1).padStart(2, '0');
			const dd = String(date.getDate()).padStart(2, '0');
			return `${yyyy}-${mm}-${dd}`;
		};

		setFilterFrom(formatDate(fromDate));
		setFilterTo(formatDate(toDate));

		if (days === 7) setActivePreset("week");
		else if (days === 30) setActivePreset("month");
		else if (days === 90) setActivePreset("90days");
	};

	useEffect(() => {
		if (!commits.length) {
			setBoard([]);
			setSelectedTiles([]);
			setRoast(null);
			setDetailsCache({});
			setDetailsLoading({});
			setDetailsError({});
			return;
		}

		generateBoard(visibleCommits);
		fetchRoast(visibleCommits);
		setDetailsCache({});
		setDetailsLoading({});
		setDetailsError({});
		setShuffleCount(1);
	}, [commits, filterFrom, filterTo]);

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

	const handleShare = async () => {
		if (board.length === 0) {
			setShareStatus("Load a board first to share it.");
			return;
		}

		setIsSharing(true);
		setShareStatus("Generating board image...");

		const topMatches = topTropes.length > 0
			? topTropes.map((tile) => `${tile.label} (${tile.matchCount})`).join(", ")
			: "no matched tropes yet";
		const shareTitle = "Commit Bingo";
		const shuffleInfo = bingoFound
			? (shuffleCount === 1 ? " (first try!)" : ` (after ${shuffleCount} shuffles)`)
			: "";
		const shareText = `I marked ${markedCount} squares on Commit Bingo${bingoFound ? ` and found bingo${shuffleInfo}` : ""}. Top matches: ${topMatches}.`;
		const shareUrl = window.location.href;

		const captureArea = document.getElementById("bingo-capture-area");
		if (!captureArea) {
			setShareStatus("Error: Capture area not found.");
			setIsSharing(false);
			return;
		}

		// Add capturing class to apply print/export specific styles
		captureArea.classList.add("capturing");

		// Give the browser 100ms to apply styles and paint
		await new Promise((resolve) => setTimeout(resolve, 100));

		try {
			const blob = await toBlob(captureArea, {
				cacheBust: true,
				style: {
					transform: "scale(1)",
					margin: "0",
				},
			});

			if (!blob) {
				throw new Error("Failed to generate image blob.");
			}

			const file = new File([blob], "commit-bingo.png", { type: "image/png" });

			// 1. Try navigator.share with files first (only on mobile browsers where native share is natural)
			const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
			if (isMobile && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
				try {
					await navigator.share({
						files: [file],
						title: shareTitle,
						text: shareText,
						url: shareUrl,
					});
					setShareStatus("Bingo board shared!");
					return;
				} catch (shareError) {
					console.log("Navigator share failed/cancelled, copying to clipboard...", shareError);
				}
			}

			// 2. Fall back to navigator.clipboard.write (write both image and plain text/url)
			try {
				const textBlob = new Blob([`${shareTitle}\n${shareText}\n${shareUrl}`], { type: "text/plain" });
				await navigator.clipboard.write([
					new ClipboardItem({
						"image/png": blob,
						"text/plain": textBlob,
					})
				]);
				setShareStatus("Board image and link copied to clipboard!");
				showScreenshotToast(blob, "Board and link copied!");
			} catch (clipboardError) {
				console.error("Failed to copy image + text, copying image only...", clipboardError);
				try {
					await navigator.clipboard.write([
						new ClipboardItem({
							"image/png": blob,
						})
					]);
					setShareStatus("Board image copied to clipboard!");
					showScreenshotToast(blob, "Board image copied!");
				} catch (imgOnlyError) {
					console.error("Failed to copy image only, copying link text...", imgOnlyError);
					await navigator.clipboard.writeText(`${shareTitle}\n${shareText}\n${shareUrl}`);
					setShareStatus("Link copied to clipboard (could not copy image).");
				}
			}
		} catch (error) {
			console.error("Error generating/sharing image:", error);
			// Fallback to text clipboard copy
			try {
				await navigator.clipboard.writeText(`${shareTitle}\n${shareText}\n${shareUrl}`);
				setShareStatus("Link copied to clipboard (could not generate image).");
			} catch (fallbackError) {
				console.error("All sharing methods failed:", fallbackError);
				setShareStatus("Could not share automatically. Copy the URL from your browser.");
			}
		} finally {
			captureArea.classList.remove("capturing");
			setIsSharing(false);
		}
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

		if (!tile || tile.isFreeSpace || !tile.isMatched) {
			return;
		}

		setSelectedTiles((current) =>
			current.includes(tileId)
				? current.filter((selectedId) => selectedId !== tileId)
				: [...current, tileId],
		);
	};

	const toggleTileDetails = async (tileId: string) => {
		const targetTile = board.find((tile) => tile.id === tileId);
		setExpandedTileId((current) => (current === tileId ? null : tileId));

		if (!targetTile || targetTile.isFreeSpace || !targetTile.isMatched) {
			return;
		}

		if (detailsCache[tileId] || detailsLoading[tileId]) {
			return;
		}

		const representativeCommit = targetTile.matchedCommits?.[0];
		if (!representativeCommit) {
			return;
		}

		setDetailsLoading((prev) => ({ ...prev, [tileId]: true }));
		setDetailsError((prev) => ({ ...prev, [tileId]: "" }));

		try {
			const query = new URLSearchParams({
				repo: representativeCommit.repo,
				sha: representativeCommit.sha,
				message: representativeCommit.message,
			}).toString();

			const response = await fetch(`/api/commit-details?${query}`);
			if (!response.ok) {
				throw new Error("Failed to fetch commit details");
			}

			const data = await response.json() as { files: CommitFileSummary[]; digest: CommitDigest };
			setDetailsCache((prev) => ({ ...prev, [tileId]: data }));
		} catch (err: any) {
			console.error("Error loading commit details:", err);
			setDetailsError((prev) => ({ ...prev, [tileId]: "Could not retrieve commit file details." }));
		} finally {
			setDetailsLoading((prev) => ({ ...prev, [tileId]: false }));
		}
	};

	const markMatchedTiles = () => {
		setSelectedTiles(board.filter((tile) => tile.isFreeSpace || tile.matchCount > 0).map((tile) => tile.id));
	};

	const clearMarks = () => {
		setSelectedTiles(board.filter((tile) => tile.isFreeSpace).map((tile) => tile.id));
		setExpandedTileId(null);
	};

	const clearFilters = () => {
		setFilterFrom("");
		setFilterTo("");
		setActivePreset("all");
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
								<span>{visibleCommits.length}</span>
								<label>commits in view</label>
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
									{loading ? "Loading commits..." : board.length ? "Reload board" : "Load board"}
								</button>
								<button onClick={handleLogout} className="ghost-button">
									Logout
								</button>
							</div>
							<div className="status-row">
								<div>
									<strong>{visibleCommits.length}</strong>
									<span>commits in view</span>
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
							<div className="filter-panel">
								<div className="filter-panel__header">
									<div>
										<p className="user-kicker">Time filter</p>
										<h3>Focus on a commit window</h3>
									</div>
									<button type="button" className="ghost-button" onClick={clearFilters} disabled={!filterFrom && !filterTo}>
										Clear filter
									</button>
								</div>
								<div className="filter-presets">
									<button type="button" className={`preset-btn ${activePreset === "week" ? "preset-btn--active" : ""}`} onClick={() => applyPreset(7)}>Past Week</button>
									<button type="button" className={`preset-btn ${activePreset === "month" ? "preset-btn--active" : ""}`} onClick={() => applyPreset(30)}>Past Month</button>
									<button type="button" className={`preset-btn ${activePreset === "90days" ? "preset-btn--active" : ""}`} onClick={() => applyPreset(90)}>Past 90 Days</button>
									<button type="button" className={`preset-btn ${activePreset === "all" ? "preset-btn--active" : ""}`} onClick={() => applyPreset(null)}>All time</button>
								</div>
								<div className="filter-row">
									<label className="filter-field">
										<span>From</span>
										<input type="date" value={filterFrom} onChange={(event) => { setFilterFrom(event.target.value); setActivePreset(null); }} />
									</label>
									<label className="filter-field">
										<span>To</span>
										<input type="date" value={filterTo} onChange={(event) => { setFilterTo(event.target.value); setActivePreset(null); }} />
									</label>
								</div>
								<p className="filter-note">
									Showing {visibleCommits.length} of {commits.length} commits.
								</p>
							</div>
							{error && <p className="error-banner">{error}</p>}
						</section>

						{board.length > 0 ? (
							<section className="board-layout">
								<div className="board-sidebar">
									<section className="panel roast-panel">
										<p className="user-kicker">AI Dev Analysis</p>
										{roastLoading ? (
											<div className="roast-shimmer">
												<div className="shimmer-title"></div>
												<div className="shimmer-meter"></div>
												<div className="shimmer-text"></div>
												<div className="shimmer-text second"></div>
											</div>
										) : roastError ? (
											<p className="roast-error">{roastError}</p>
										) : roast ? (
											<div className="roast-content">
												<div className="roast-header">
													<span className="roast-badge">{roast.archetype}</span>
												</div>
												
												<div className="chaos-meter-container">
													<div className="chaos-meter-label">
														<span>Chaos Rating</span>
														<strong>{roast.chaosRating}%</strong>
													</div>
													<div className="chaos-meter-track">
														<div 
															className="chaos-meter-fill" 
															style={{ width: `${roast.chaosRating}%` }}
														></div>
													</div>
												</div>

												<blockquote className="roast-quote">
													<p>"{roast.roast}"</p>
												</blockquote>

												<div className="roast-superpower">
													<span className="superpower-icon">⚡</span>
													<div className="superpower-details">
														<label>Dev Superpower</label>
														<p>{roast.superpower}</p>
													</div>
												</div>
											</div>
										) : (
											<p className="roast-placeholder">Generate a board to see your AI roast.</p>
										)}
									</section>

									<aside className="panel board-note">
										<p className="user-kicker">{topTropes.length > 0 ? "Top matches" : "How it works"}</p>
										{topTropes.length > 0 ? (
											<div className="insight-list">
												{topTropes.map((tile) => (
													<div key={tile.id} className="insight-item">
														<strong>{tile.label}</strong>
														<span>{tile.matchCount} match{tile.matchCount === 1 ? "" : "es"}</span>
													</div>
												))}
											</div>
										) : (
											<p className="board-note__tip">
												Each square is a commit trope. Matches glow with a count and a sample message. Line up a row, column, or diagonal.
											</p>
										)}
									</aside>
								</div>

								<section className="panel board-panel">
									<div className="board-header">
										<div>
											<p className="user-kicker">Generated board</p>
											<h2>Trope Bingo</h2>
										</div>
										<div className="board-header__actions">
											<p>
												<strong>{selectedTiles.length} / {board.length}</strong> marked
											</p>
										</div>
									</div>
									{shareStatus && <p className="share-status">{shareStatus}</p>}

									<div id="bingo-capture-area" className="bingo-capture-area">
										<div className="capture-header">
											<span className="capture-header-title">
												COMMIT BINGO {bingoFound && (shuffleCount === 1 ? "★ 1st Try" : `★ Try #${shuffleCount}`)}
											</span>
											<span className="capture-header-stats">
												{selectedTiles.length} / {board.length} marked
											</span>
										</div>

										<div className="bingo-grid">
											{board.map((tile) => {
												const isSelected = selectedTileSet.has(tile.id);

												return (
													<article
														key={tile.id}
														className={`tile-card ${tile.isFreeSpace ? "tile--free" : ""} ${tile.isMatched ? "tile--matched" : "tile--unmatched"} ${isSelected ? "tile--selected" : ""}`}
														onClick={tile.isMatched ? () => toggleTile(tile.id) : undefined}
														onKeyDown={tile.isMatched ? (event) => {
															if (event.key === "Enter" || event.key === " ") {
																event.preventDefault();
																toggleTile(tile.id);
															}
														} : undefined}
														role={tile.isMatched ? "button" : undefined}
														tabIndex={tile.isMatched && !tile.isFreeSpace ? 0 : -1}
														aria-pressed={tile.isMatched ? isSelected : undefined}
														aria-label={`${tile.label}${tile.isFreeSpace ? ", free space" : tile.isMatched ? `, ${isSelected ? "selected" : "not selected"}` : ", no matches yet"}`}
													>
															<div className="tile-card__head">
																<span className="tile-label">{tile.label}</span>
																<span className="tile-meta">
																	{tile.isFreeSpace
																		? "center square"
																		: tile.matchCount > 0
																			? `${tile.matchCount} match${tile.matchCount === 1 ? "" : "es"}`
																			: "no matches yet"}
																</span>
															</div>

															<div className="tile-card__actions">
																<button
																	type="button"
																	className="tile-action tile-action--ghost"
																	onClick={(event) => {
																		event.stopPropagation();
																		toggleTileDetails(tile.id);
																	}}
																	disabled={tile.isFreeSpace}
																>
																		Info
																</button>
																{!tile.isFreeSpace && !tile.isMatched && (
																	<button
																		type="button"
																		className="tile-action tile-action--reroll"
																		onClick={(event) => {
																			event.stopPropagation();
																			rerollTile(tile.id);
																		}}
																		disabled={rerollsLeft <= 0}
																		title={`Reroll this trope (Rerolls left: ${rerollsLeft})`}
																	>
																		Reroll ({rerollsLeft})
																	</button>
																)}
															</div>

															<span className="tile-note">
																{tile.isFreeSpace
																	? "free space"
																	: tile.isMatched
																		? tile.examples[0] || tile.hint || tile.label
																		: tile.hint || "no matched commits"}
															</span>

														</article>
												);
											})}
										</div>

										<div className="capture-footer">
											<span className="capture-footer-text">
												See the tropes hiding in your commit history
											</span>
											<span className="capture-footer-link">
												{window.location.host || "commit-bingo"}
											</span>
										</div>
									</div>
										<div className={`board-status ${bingoFound ? "board-status--win" : ""}`}>
											<span className="board-status__dot" aria-hidden="true"></span>
											<span className="board-status__label">
												{bingoFound
													? (shuffleCount === 1
														? "Bingo found on the first try!"
														: `Bingo found on try #${shuffleCount}`)
													: "Keep marking squares"}
											</span>
											<span className="board-status__count">{selectedTiles.length} / {board.length} marked</span>
										</div>
											{expandedTile && (
												<div className="tile-modal-backdrop" onClick={() => setExpandedTileId(null)}>
													<div className="tile-modal" onClick={(event) => event.stopPropagation()}>
														<div className="tile-modal__header">
															<div>
																<p className="user-kicker">Selected commit summary</p>
																<h2>{expandedTile.label}</h2>
															</div>
															<button type="button" className="ghost-button" onClick={() => setExpandedTileId(null)}>
																Close
															</button>
														</div>
														<p className="tile-modal__lede">
															{expandedTile.isFreeSpace
																? "Free space in the middle."
																: expandedTile.isMatched
																	? expandedTile.examples[0] || expandedTile.hint || expandedTile.label
																	: expandedTile.hint || "No matching commits found for this trope."}
														</p>
														{detailsLoading[expandedTile.id] ? (
															<div className="roast-shimmer" style={{ marginTop: "1.5rem", padding: "1rem 0" }}>
																<div className="shimmer-title" style={{ width: "40%" }}></div>
																<div className="shimmer-text" style={{ height: "16px", margin: "10px 0" }}></div>
																<div className="shimmer-text second" style={{ height: "16px", width: "80%" }}></div>
															</div>
														) : detailsError[expandedTile.id] ? (
															<p className="roast-error" style={{ color: "#ef4444", marginTop: "1rem" }}>{detailsError[expandedTile.id]}</p>
														) : detailsCache[expandedTile.id] ? (
															<>
																<div className="summary-grid">
																	<div><strong>{expandedTile.matchCount}</strong><span>matches</span></div>
																	<div><strong>{expandedTile.repoNames.map((name) => name.split("/")[1] || name).join(", ") || "-"}</strong><span>repos</span></div>
																	<div><strong>{detailsCache[expandedTile.id]!.digest.language || "-"}</strong><span>change type</span></div>
																	<div><strong>{detailsCache[expandedTile.id]!.digest.confidence || "-"}</strong><span>confidence</span></div>
																</div>
																<div className="summary-blocks">
																	<div>
																		<h3>What changed</h3>
																		<p>{detailsCache[expandedTile.id]!.digest.insight}</p>
																	</div>
																	<div>
																		<h3>Files ({detailsCache[expandedTile.id]!.digest.changedFiles.length})</h3>
																		<ul>
																			{detailsCache[expandedTile.id]!.digest.changedFiles.slice(0, 6).map((file) => <li key={file}>{file}</li>)}
																		</ul>
																	</div>
																</div>
															</>
														) : (
															<>
																<div className="summary-grid">
																	<div><strong>{expandedTile.matchCount}</strong><span>matches</span></div>
																	<div><strong>{expandedTile.repoNames.map((name) => name.split("/")[1] || name).join(", ") || "-"}</strong><span>repos</span></div>
																	<div><strong>{expandedTile.digest?.language || "-"}</strong><span>change type</span></div>
																	<div><strong>{expandedTile.digest?.confidence || "-"}</strong><span>confidence</span></div>
																</div>
																{expandedTile.digest && (
																	<div className="summary-blocks">
																		<div>
																			<h3>What changed</h3>
																			<p>{expandedTile.digest.insight}</p>
																		</div>
																		<div>
																			<h3>Files</h3>
																			<p style={{ opacity: 0.7, fontSize: "0.875rem" }}>Click close and click Info again to try loading file list.</p>
																		</div>
																	</div>
																)}
															</>
														)}
														{expandedTile.matchedCommits && expandedTile.matchedCommits.length > 0 && (
															<div className="commit-evidence-panel">
																<h3>Evidence Commits</h3>
																<ul className="commit-evidence-list">
																	{expandedTile.matchedCommits.map((c) => (
																		<li key={c.sha}>
																			<a
																				href={`https://github.com/${c.repo}/commit/${c.sha}`}
																				target="_blank"
																				rel="noopener noreferrer"
																				className="commit-evidence-link"
																			>
																				<span className="commit-repo">[{c.repo.split("/")[1] || c.repo}]</span>{" "}
																				<span className="commit-msg">{c.message}</span>{" "}
																				<span className="commit-hash">({c.sha.slice(0, 7)})</span>
																			</a>
																		</li>
																	))}
																</ul>
															</div>
														)}
													</div>
												</div>
											)}
								</section>
							</section>
						) : (
									<section className="panel empty-state">
										<h2>No board yet</h2>
										<p>
											{commits.length === 0
												? "Load your commits to generate the first board. The app will create one automatically after the fetch completes."
												: "No commits match the selected timeframe. Clear the filter to bring the board back."}
										</p>
										{commits.length > 0 && (
											<button type="button" className="secondary-button" onClick={clearFilters}>
												Clear filter
											</button>
										)}
									</section>
						)}
					</>
				)}
			</main>

			{board.length > 0 && (
				<div className="floating-control-bar">
					<button
						type="button"
						onClick={markMatchedTiles}
						disabled={loading}
						className="floating-btn"
						title="Auto-mark matches"
					>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
							<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z"/>
							<path d="m14 7 3 3"/>
							<path d="M5 6v4"/>
							<path d="M19 14v4"/>
							<path d="M10 2v2"/>
							<path d="M7 8H3"/>
							<path d="M21 16h-4"/>
							<path d="M11 3H9"/>
						</svg>
						<span>Auto-mark</span>
					</button>

					<button
						type="button"
						onClick={clearMarks}
						disabled={loading}
						className="floating-btn"
						title="Clear marks"
					>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
							<path d="M3 6h18"/>
							<path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
							<path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
						</svg>
						<span>Clear</span>
					</button>

					<button
						type="button"
						onClick={() => {
							generateBoard(commits);
							setShuffleCount((prev) => prev + 1);
						}}
						disabled={loading}
						className="floating-btn"
						title="Shuffle tropes"
					>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
							<path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/>
							<path d="m18 2 4 4-4 4"/>
							<path d="M2 6h1.9c1.2 0 2.3.6 3 1.7l1.1 1.6"/>
							<path d="m15.4 12.8 1.2 1.7c.8 1.1 2 1.7 3.2 1.7H22"/>
							<path d="m18 14 4 4-4 4"/>
						</svg>
						<span>Shuffle</span>
					</button>

					<div className="floating-divider"></div>

					<button
						type="button"
						onClick={handleShare}
						disabled={isSharing}
						className="floating-btn floating-btn--primary"
						title="Share board image"
					>
						{isSharing ? (
							<>
								<span className="floating-spinner"></span>
								<span>Generating...</span>
							</>
						) : (
							<>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
									<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
									<polyline points="16 6 12 2 8 6"/>
									<line x1="12" y1="2" x2="12" y2="15"/>
								</svg>
								<span>Share card</span>
							</>
						)}
					</button>
				</div>
			)}

			{screenshotToast && (
				<div className={`screenshot-toast-container ${screenshotToast.hiding ? "hiding" : ""}`}>
					<div className="screenshot-toast-thumbnail-wrapper" onClick={closeToast}>
						<img
							src={screenshotToast.imageUri}
							alt="Screenshot Preview"
							className="screenshot-toast-thumbnail"
						/>
						<button
							type="button"
							className="screenshot-toast-dismiss"
							onClick={(e) => {
								e.stopPropagation();
								closeToast();
							}}
							aria-label="Dismiss"
						>
							✕
						</button>
					</div>
					<div className="screenshot-toast-bubble">
						<span>{screenshotToast.message}</span>
					</div>
				</div>
			)}
		</div>
	);
}

export default App;
