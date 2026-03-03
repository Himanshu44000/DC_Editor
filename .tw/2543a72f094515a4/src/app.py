from dataclasses import dataclass


@dataclass
class GreetingResult:
    message: str


def build_greeting(name: str) -> GreetingResult:
    cleaned_name = (name or 'Developer').strip() or 'Developer'
    return GreetingResult(message=f'Hello, {cleaned_name}!')
