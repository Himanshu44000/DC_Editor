import argparse
from app import build_greeting

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Python CLI starter")
    parser.add_argument("--name", default="Developer")
    parser.add_argument("--count", type=int, default=1)
    return parser.parse_args()

def main() -> None:
    args = parse_args()
    for i in range(max(1, args.count)):
        msg = build_greeting(args.name).message
        print(f"{i + 1}. {msg}")

if __name__ == "__main__":
    main()