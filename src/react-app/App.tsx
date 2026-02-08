import { useState, useEffect } from "react";
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

function App() {
	const [user, setUser] = useState<GitHubUser | null>(null);
	const [commits, setCommits] = useState<Commit[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string>("");

	// Check if user is already logged in
	useEffect(() => {
		fetch("/api/user")
			.then((res) => {
				if (res.ok) {
					return res.json();
				}
				return null;
			})
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
			setCommits(data.commits || []);
		} catch (err) {
			setError("Failed to load commits. Please try again.");
			console.error(err);
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="app">
			<header>
				<h1>Commit Bingo</h1>
				<p>Generate a bingo board from your GitHub commit messages</p>
			</header>

			{!user ? (
				<div className="login-section">
					<h2>Sign in with GitHub</h2>
					<p>Connect your GitHub account to analyze your commit messages</p>
					<button onClick={handleLogin} className="login-button">
						Login with GitHub
					</button>
				</div>
			) : (
				<div className="user-section">
					<div className="user-info">
						<img
							src={user.avatar_url}
							alt={user.login}
							className="avatar"
						/>
						<div>
							<h2>Welcome, {user.name || user.login}!</h2>
							<p>@{user.login} | {user.public_repos} public repos</p>
						</div>
						<button onClick={handleLogout} className="logout-button">
							Logout
						</button>
					</div>

					<div className="commits-section">
						<button
							onClick={fetchCommits}
							disabled={loading}
							className="fetch-button"
						>
							{loading ? "Loading..." : "Load My Commits"}
						</button>

						{error && <p className="error">{error}</p>}

						{commits.length > 0 && (
							<div className="commits-list">
								<h3>Found {commits.length} commits!</h3>
								<p>Now you can generate a bingo board from these commit messages</p>
								<div className="commits-preview">
									{commits.slice(0, 10).map((commit, idx) => (
										<div key={idx} className="commit-item">
											<strong>{commit.repo}</strong>
											<p>{commit.message.split('\n')[0]}</p>
											<small>{new Date(commit.date).toLocaleDateString()}</small>
										</div>
									))}
									{commits.length > 10 && (
										<p>...and {commits.length - 10} more commits</p>
									)}
								</div>
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

export default App;
