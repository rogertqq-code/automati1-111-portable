/// Wicketkeeper.io Proof-of-Work Solver
///
/// Brute-force SHA-256 nonce finder for Wicketkeeper PoW challenges.
/// Takes a JWT token and difficulty level, finds a nonce such that
/// SHA-256(jwt + nonce) has `difficulty` leading zero bits.
///
/// Usage:
///   pow-solver --jwt <token> --difficulty <n>
///
/// Output:
///   Prints the nonce to stdout on success, exits with code 1 on failure.

use clap::Parser;
use sha2::{Sha256, Digest};
use std::time::Instant;

#[derive(Parser, Debug)]
#[command(name = "pow-solver", about = "Wicketkeeper PoW nonce finder")]
struct Args {
    /// JWT token from the Wicketkeeper challenge
    #[arg(long)]
    jwt: String,

    /// Difficulty level (number of leading zero bits required)
    #[arg(long, default_value = "20")]
    difficulty: u32,

    /// Maximum iterations before giving up (0 = unlimited)
    #[arg(long, default_value = "100000000")]
    max_iterations: u64,
}

/// Check if a hash has the required number of leading zero bits.
fn has_leading_zeros(hash: &[u8], difficulty: u32) -> bool {
    let full_bytes = (difficulty / 8) as usize;
    let remaining_bits = difficulty % 8;

    // Check full zero bytes
    for byte in hash.iter().take(full_bytes) {
        if *byte != 0 {
            return false;
        }
    }

    // Check remaining bits in the next byte
    if remaining_bits > 0 && full_bytes < hash.len() {
        let mask = 0xFF << (8 - remaining_bits);
        if hash[full_bytes] & mask != 0 {
            return false;
        }
    }

    true
}

fn main() {
    let args = Args::parse();
    let start = Instant::now();

    eprintln!(
        "[pow-solver] Starting: difficulty={}, jwt_len={}",
        args.difficulty,
        args.jwt.len()
    );

    let jwt_bytes = args.jwt.as_bytes();

    for nonce in 0..args.max_iterations {
        let nonce_str = nonce.to_string();
        let nonce_bytes = nonce_str.as_bytes();

        // Compute SHA-256(jwt + nonce)
        let mut hasher = Sha256::new();
        hasher.update(jwt_bytes);
        hasher.update(nonce_bytes);
        let result = hasher.finalize();

        if has_leading_zeros(&result, args.difficulty) {
            let elapsed = start.elapsed();
            eprintln!(
                "[pow-solver] Solution found in {:.2}s ({} iterations): nonce={}",
                elapsed.as_secs_f64(),
                nonce,
                nonce_str
            );
            // Output nonce to stdout (this is what the Node.js caller reads)
            println!("{}", nonce_str);
            return;
        }

        // Progress report every 10M iterations
        if nonce > 0 && nonce % 10_000_000 == 0 {
            let elapsed = start.elapsed();
            let rate = nonce as f64 / elapsed.as_secs_f64();
            eprintln!(
                "[pow-solver] Progress: {} iterations, {:.0} H/s",
                nonce, rate
            );
        }
    }

    eprintln!(
        "[pow-solver] No solution found after {} iterations",
        args.max_iterations
    );
    std::process::exit(1);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_leading_zeros_check() {
        // All zeros
        assert!(has_leading_zeros(&[0x00, 0x00, 0x00, 0xFF], 24));
        assert!(has_leading_zeros(&[0x00, 0x00, 0x00, 0xFF], 20));

        // Not enough zeros
        assert!(!has_leading_zeros(&[0x01, 0x00, 0x00, 0xFF], 8));
        assert!(!has_leading_zeros(&[0x00, 0x80, 0x00, 0xFF], 9));

        // Partial byte check
        assert!(has_leading_zeros(&[0x00, 0x0F, 0xFF, 0xFF], 12));
        assert!(!has_leading_zeros(&[0x00, 0x1F, 0xFF, 0xFF], 12));
    }

    #[test]
    fn test_simple_solve() {
        // Quick solve with low difficulty
        let jwt = "test_jwt_token";
        let jwt_bytes = jwt.as_bytes();
        let difficulty = 8; // Only 1 byte of zeros needed

        let mut found = false;
        for nonce in 0..1_000_000u64 {
            let nonce_str = nonce.to_string();
            let mut hasher = Sha256::new();
            hasher.update(jwt_bytes);
            hasher.update(nonce_str.as_bytes());
            let result = hasher.finalize();

            if has_leading_zeros(&result, difficulty) {
                found = true;
                break;
            }
        }
        assert!(found, "Should find a solution within 1M iterations for difficulty 8");
    }
}
