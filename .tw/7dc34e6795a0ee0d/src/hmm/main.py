import argparse

from .app import build_greeting


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description='Python CLI starter')
    subparsers = parser.add_subparsers(dest='command', required=True)

    greet_parser = subparsers.add_parser('greet', help='print a greeting')
    greet_parser.add_argument('--name', default='Developer', help='Name to greet')
    greet_parser.add_argument('--excited', action='store_true', help='Add exclamation mark')

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if args.command == 'greet':
        result = build_greeting(args.name, excited=bool(args.excited))
        print(result.message)
        return 0

    parser.print_help()
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
